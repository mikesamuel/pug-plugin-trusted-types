'use strict';

/**
 * @fileoverview
 * Exports a Pug plugin that runs just before the Pug code-generator to
 * add guards to user expressions.
 *
 * These user expressions require that dynamic attributes and text nodes
 * conform to policies defined in ../guards/index.js.
 *
 * Which policies apply are determined by ../contracts/index.js.
 *
 * The policies are enforced at runtime by ../contracts/index.js.
 *
 * If a template avoids known unsafe features, then this plugin also
 * "blesses" the output as TrustedHTML.
 */

/* eslint { "complexity": [ 2, { max: 15 } ] } */

const crypto = require('crypto');
const path = require('path');

const constantinople = require('constantinople');
const stringify = require('js-stringify');
const { parse, parseExpression } = require('@babel/parser');
const { default: generate } = require('@babel/generator');

const { contentTypeForElement, typeOfAttribute } = require('pug-contracts-trusted-types');
const {
  trustedHTMLGuard,
  trustedScriptGuard,
  GUARDS_BY_ATTRIBUTE_TYPE,
  GUARDS_BY_ELEMENT_CONTENT_TYPE,
} = require('pug-guards-trusted-types');

/**
 * Given a multimap that uses sets to collect values,
 * adds the value to the set for the given key.
 */
function multiMapSet(multimap, key, value) {
  if (!multimap.has(key)) {
    multimap.set(key, new Set());
  }
  const values = multimap.get(key);
  if (!values.has(value)) {
    values.add(value);
    return true;
  }
  return false;
}

/**
 * Given a set of graph nodes to labels, propagates labels to
 * across edges.
 *
 * @param nodeLabels a Map of nodes to labels.  Modified in place.
 * @param graph an adjacency table such that graph[src] is a series of targets,
 *    nodes adjacent to src.
 */
function transitiveClosure(nodeLabels, graph) {
  let madeProgress = false;
  do {
    madeProgress = false;
    for (const [ src, values ] of Array.from(nodeLabels.entries())) {
      const targets = graph[src];
      if (targets) {
        for (const target of targets) {
          for (const value of values) {
            madeProgress = multiMapSet(nodeLabels, target, value) || madeProgress;
          }
        }
      }
    }
  } while (madeProgress);
}


/**
 * True if the named element may contain tag content.
 * @param element a lower-case HTML element name.
 */
function mayContainTags(element) {
  element = element.toLowerCase();
  return element !== 'script' && element !== 'style' && element !== 'iframe';
}

// The matched text is the malformed markup
const MALFORMED_MARKUP = new RegExp(
  // This requires a '>' after any '<' or '</' followed by a letter
  // and does not count a '>' that is inside quotes following an '='.
  String.raw`<\/?[a-zA-Z](?:[^>=]|=[\t\n\f\r ]*(?:"[^"]*"?|'[^']*'?)?)*$` +
  // Comments should not embed -- that is not part of their end delimiter.
  String.raw`|<!--[\s\S]*?--(?:[^>]|$)` +
  // Short comments are lexical corner cases.
  String.raw`|<!---?(?:>|$)` +
  // Unclosed pseudo comments.
  String.raw`|<(?:[?]|!(?!--))[^>]*$`);

module.exports = Object.freeze({
  // Hook into PUG just before the AST is converted to JS code.
  // eslint-disable-next-line func-name-matching, no-unused-vars
  preCodeGen: function enforceTrustedTypes(inputAst, options) {
    // PUG provides no way to forward options to plugins, so we piggyback on
    // filterOptions.
    let {
      csrfInputName,
      csrfInputValueExpression, // eslint-disable-line prefer-const
      nonceValueExpression, // eslint-disable-line prefer-const
      report,
    } = (options.filterOptions || {}).trustedTypes || {};

    // eslint-disable-next-line no-console
    report = report || console.warn.bind(console);
    csrfInputName = csrfInputName || 'csrfToken';

    let ast = null;
    let unpredictableSuffix = null;
    {
      // Defensively copy the AST.
      const astJson = JSON.stringify(inputAst);
      ast = JSON.parse(astJson);
      // Produce a stable but unguessable ID so we can get unmaskable access
      // to our runtime support code.
      const unpredictableSuffixHash = crypto.createHash('sha256');
      unpredictableSuffixHash.update(astJson);
      unpredictableSuffix = unpredictableSuffixHash.digest('hex');
    }

    // If we make any changes, we'll inject runtime support.
    let needsRuntime = false;
    let needsScrubber = false;

    // Keep track of the mixin call graph and which might be called in sensitive
    // contexts.
    const deferred = [];
    const calledInSensitiveContext = new Map();
    // Maps each name of a mixin to the names of mixins it calls in a text context.
    const mixinCallGraph = Object.create(null);

    // A sequence of (object, key) pairs that were traversed to reach the
    // current AST node.
    const policyPath = [];

    // Don't convert the output as TrustedHTML if the template uses known unsafe
    // features.
    let mayTrustOutput = true;

    // Logs a message and flips a bit so that we do not bless the output of this template.
    function distrust(msg, optAstNode) {
      const { filename, line } = optAstNode || policyPath[policyPath.length - 2] || {};
      const relfilename = options.basedir ? path.relative(options.basedir, filename) : filename;
      report(`${ relfilename }:${ line }: ${ msg }`);
      mayTrustOutput = false;
    }

    // Walk upwards to find the enclosing tag and mixin if any.
    function getContainerName(skip = 0) {
      let element = null;
      let mixin = null;
      for (let i = policyPath.length - (skip * 2); (i -= 2) >= 0;) {
        const policyPathElement = policyPath[i];
        if (typeof policyPathElement === 'object') {
          if (policyPathElement.type === 'Tag') {
            element = policyPathElement.name.toLowerCase();
            break;
          } else if (policyPathElement.type === 'Mixin' && !policyPathElement.call) {
            mixin = policyPathElement.name;
            break;
          }
        }
      }
      return { element, mixin };
    }

    // Sometimes the type for one attribute depends on another.
    // For example, the sensitivity of <link href> depends on
    // the value of rel.
    function valueGetter({ attrs, attributeBlocks }) {
      let values = null;
      return function getValue(name) {
        if (!values) {
          values = new Map();
          // Look in &attributes(...) style attribute blocks for any known values.
          // eslint-disable-next-line no-unused-vars
          for (const attributeBlock of attributeBlocks) {
            const jsAst = parseExpression(attributeBlock.val);
            if (jsAst.type === 'ObjectExpression' && jsAst.properties) {
              for (const property of jsAst.properties) {
                if (property.type !== 'ObjectProperty' || property.method || property.computed) {
                  // Can't sanitize getters or methods, or spread elements.
                  continue;
                }
                const attrName = property.key.name || property.key.value;
                const { code: valueExpression } = generate(property.value);
                if (constantinople(valueExpression)) {
                  values.set(attrName, constantinople.toConstant(valueExpression));
                }
              }
            }
          }
          // Find any known values among the (attr=expr, ...) style attributes.
          for (const attr of attrs) {
            if (constantinople(attr.val)) {
              values.set(attr.name, constantinople.toConstant(attr.val));
            }
          }
        }

        name = String(name).toLowerCase();
        return values.get(name);
      };
    }

    // Check well-formedness of user expressions.
    // This may be redundant with Pug codegen, but otherwise
    // a guard expression like
    //      rt_abcd.requireFoo(${ expr })
    // could be bypassed by an expr like ` 'ok'), (x ` that combines
    // with that to produce an ineffective guard expression:
    //      rt_abcd.requireFoo('ok'), (x)
    function isWellFormed(expr) {
      try {
        // Should throw if attr.val is not well-formed.
        // eslint-disable-next-line no-new, no-new-func
        new Function(`return () => (${ expr })`);
      } catch (exc) {
        report(`Malformed expression in Pug template: ${ expr }`);
        return false;
      }
      return true;
    }

    // Decorate expression text with a call to a guard function.
    function addGuard(guard, expr) {
      let safeExpr = null;
      if (!isWellFormed(expr)) {
        expr = '{/*Malformed Expression*/}';
      }
      needsRuntime = true;
      safeExpr = ` rt_${ unpredictableSuffix }.${ guard }(${ expr }) `;
      return safeExpr;
    }

    // Decorate expression text with a call to a scrubber function
    // that checks an entire attribute bundle at runtime.
    function addScrubber(scrubber, element, expr) {
      let safeExpr = null;
      if (!isWellFormed(expr)) {
        expr = '{/*Malformed Expression*/}';
      }
      needsScrubber = true;
      safeExpr = ` sc_${ unpredictableSuffix }.${ scrubber }(${ stringify(element || '*') }, ${ expr }) `;
      return safeExpr;
    }

    // Add a guard if necessary.
    // - elementName: string - lower case
    // - attrName: string
    // - getValue(attrName) - returns the value of another attribute on the same element if known
    // - valueExpression: string - a JS expression that computes the result
    // - onNewValue(newValueExpression) - called with any newly guarded value expression.
    //     Not called if no guard required.
    function maybeGuardAttributeValue(
      elementName, attrName, getValue, valueExpression, onNewValue) {
      attrName = String(attrName).toLowerCase();
      const type = typeOfAttribute(elementName || '*', attrName, getValue);
      if (type === null) {
        distrust(`Cannot trust dynamic value for <${ elementName } ${ attrName }>`);
      } else {
        const guard = GUARDS_BY_ATTRIBUTE_TYPE[type];
        if (guard) {
          onNewValue(addGuard(guard, valueExpression));
        }
      }
    }

    // If user expressions have free variables like pug_html then don't bless
    // the output because we'd have to statically analyze the generated JS to
    // preserve output integrity.
    function checkCodeDoesNotInterfere(astNode, exprKey, isExpression) {
      let expr = astNode[exprKey];
      const seen = new Set();

      const type = typeof expr;
      if (type !== 'string') {
        // expr may be true, not "true".
        // This occurs for inferred expressions like valueless attributes.
        expr = `${ expr }`;
        astNode[exprKey] = expr;
      }

      let warnedPug = false;
      let warnedModule = false;
      // Allows check to take into account the context in which a node appears.
      // Flattened pairs of [ancestor, keyInAncestorToDescendent].
      const jsAstPath = [];

      function check(jsAst) {
        if (jsAst && typeof jsAst === 'object' && jsAst.type === 'Identifier') {
          const { name } = jsAst;
          if (/^pug_/.test(name) || name === 'eval') {
            if (!warnedPug) {
              distrust(`Expression (${ expr }) may interfere with PUG internals ${ jsAst.name }`);
              warnedPug = true;
            }
          } else if (name === 'require' &&
                     // Allow trusted plugin code to require modules they need.
                     !(Object.hasOwnProperty.call(astNode, 'mayRequire') && astNode.mayRequire) &&
                     // Allow require.moduleKeys and require.resolve but not require(moduleId).
                     !(jsAstPath.length && jsAstPath[jsAstPath.length - 2].type === 'MemberExpression' &&
                       jsAstPath[jsAstPath.length - 1] === 'object')) {
            // Defang expression.
            astNode[exprKey] = 'null';
            // We trust trusted plugin code and PUG code to use the module's private key
            // but not template code.
            if (!warnedModule) {
              distrust(`Expression (${ expr }) may interfere with module internals ${ jsAst.name }`);
              warnedModule = true;
            }
          }
        }
        checkChildren(jsAst); // eslint-disable-line no-use-before-define
      }

      function checkChildren(jsAst) {
        if (!seen.has(jsAst)) {
          seen.add(jsAst);
          const jsAstPathLength = jsAstPath.length;
          jsAstPath[jsAstPathLength] = jsAst;
          for (const key in jsAst) {
            if (Object.hasOwnProperty.call(jsAst, key)) {
              jsAstPath[jsAstPathLength + 1] = key;
              check(jsAst[key]);
            }
          }
          jsAstPath.length = jsAstPathLength;
        }
      }

      let root = null;
      try {
        root = isExpression ? parseExpression(expr) : parse(expr);
      } catch (exc) {
        distrust(`Malformed expression (${ expr })`);
        return;
      }
      check(root);
    }

    // Add nonce attributes to attribute sets as needed.
    function noncifyAttrs(element, getValue, attrs) {
      if (nonceValueExpression) {
        if (element === 'script' || element === 'style' ||
            (element === 'link' && (getValue('rel') || '').toLowerCase() === 'stylesheet')) {
          if (attrs.findIndex(({ name }) => name === 'nonce') < 0) {
            attrs[attrs.length] = {
              name: 'nonce',
              val: nonceValueExpression,
              mustEscape: true,
            };
          }
        }
      }
    }

    // Add nonce attributes to tags as needed.
    function noncifyTag({ name, block: { nodes } }) {
      if (name === 'form' && csrfInputValueExpression) {
        nodes.unshift({
          type: 'Conditional',
          test: csrfInputValueExpression,
          consequent: {
            type: 'Block',
            nodes: [
              {
                type: 'Tag',
                name: 'input',
                selfClosing: false,
                block: {
                  type: 'Block',
                  nodes: [],
                },
                attrs: [
                  {
                    name: 'name',
                    val: stringify(csrfInputName),
                    mustEscape: true,
                  },
                  {
                    name: 'type',
                    val: '\'hidden\'',
                    mustEscape: true,
                  },
                  {
                    name: 'value',
                    val: csrfInputValueExpression,
                    mustEscape: true,
                  },
                ],
                attributeBlocks: [],
                isInline: false,
              },
            ],
          },
          alternate: null,
        });
      }
    }

    // Keys match keys in the Pug AST.  The input is the referent of policyPath.
    const policy = {
      __proto__: null,
      type: {
        __proto__: null,
        Code(obj) {
          // When we see a code block, sanity check it, and if it specifies text content,
          // add any guards needed.
          // If the code appears in a mixin we might have to defer adding guards until we
          // understand the mixin call graph.
          if (constantinople(obj.val)) {
            return;
          }
          checkCodeDoesNotInterfere(obj, 'val', obj.buffer);
          if (obj.buffer) {
            const { element, mixin } = getContainerName();
            const contentType = contentTypeForElement(element);
            let guard = contentType ? GUARDS_BY_ELEMENT_CONTENT_TYPE[contentType] : null;
            if (!guard) {
              if (!element && mixin) {
                deferred.push({ mixin, code: obj });
                return;
              }
              guard = trustedHTMLGuard;
            }
            obj.val = addGuard(guard, obj.val);
            obj.mustEscape = false;
          }
        },
        Comment(obj) {
          // User comments can lead to confusing tokenization since
          // -->
          // seems like it should run to end of line but does not.
          if (/--|^-?$/.test(obj.val)) {
            distrust(`Invalid comment content ${ JSON.stringify(obj.val) }`);
          }
        },
        Mixin(obj) {
          // Both calls and definitions have type:'Mixin'
          if (obj.call) {
            if (/\S/.test(obj.args)) {
              checkCodeDoesNotInterfere(obj, 'args', true);
            }
            const { element, mixin } = getContainerName();
            const contentType = contentTypeForElement(element);
            const guard = contentType ? GUARDS_BY_ELEMENT_CONTENT_TYPE[contentType] : null;
            if (guard) {
              multiMapSet(calledInSensitiveContext, obj.name, guard);
            } else if (mixin) {
              mixinCallGraph[mixin] = mixinCallGraph[mixin] || [];
              mixinCallGraph[mixin].push(obj.name);
            }
          }
        },
        Tag(obj) {
          // Record information about which contexts tags appear in so we can avoid
          // confusion due to tag-like content in non-tag contexts like
          // <script><div>
          const { element, mixin } = getContainerName(1);
          if (element) {
            if (!mayContainTags(element)) {
              distrust(`HTML tag <${ obj.name }> appears inside <${ element }> which cannot have tag content`);
            }
          } else if (mixin) {
            deferred.push({ mixin, tag: obj });
          }
          noncifyTag(obj);
        },
        Text(obj) {
          // Inline HTML is a token-level integrity risk.
          if (obj.isHtml) {
            const match = MALFORMED_MARKUP.exec(obj.val);
            if (match) {
              distrust(`Malformed HTML markup ${ match[0] }`);
            }
          }
        },
        Each(obj) {
          checkCodeDoesNotInterfere(obj, 'val', true);
        },
      },
      // "attrs"'s value maps HTML attribute names to AST nodes representing value expressions.
      attrs(obj) {
        const parent = policyPath[policyPath.length - 2];
        const getValue = valueGetter(parent);
        // If the attributes appear directly on a call, do not assume any containing
        // element context
        const element = parent.call ? null : getContainerName().element;
        // Iterate over attributes and add checks as necessary.
        for (const attr of obj) {
          if (constantinople(attr.val)) {
            if (!attr.mustEscape) {
              const constant = constantinople.toConstant(attr.val);
              if (/"/.test(constant)) {
                // TODO: upstream a fix to pug_attr so that pug_attr('name', 'val">', false).
                // https://github.com/pugjs/pug/pull/3073
                distrust(`Attribute value ${ constant } breaks attribute quoting`);
              }
            }
          } else {
            checkCodeDoesNotInterfere(attr, 'val', true);
            maybeGuardAttributeValue(
              element, attr.name, getValue, attr.val,
              (guardedExpression) => {
                attr.val = guardedExpression;
              });
            if (!attr.mustEscape) {
              distrust(`The value of the ${ attr.name } attribute must be escaped`);
            }
          }
        }
        noncifyAttrs(element, getValue, obj);
      },
      // "attributeBlocks" allow a single expression to specify a group of attributes.
      attributeBlocks(obj) {
        const parent = policyPath[policyPath.length - 2];
        const getValue = valueGetter(parent);
        // If the attributes appear directly on a call, do not assume any containing
        // element context
        const element = parent.call ? null : getContainerName().element;
        for (const attributeBlock of obj) {
          checkCodeDoesNotInterfere(attributeBlock, 'val', true);
          // Parse the expression and look for constant properties to guard.
          const jsAst = parseExpression(attributeBlock.val);
          let needsDynamicScrubbing = true;
          let changedAst = false;
          if (jsAst.type === 'ObjectExpression' && jsAst.properties) {
            needsDynamicScrubbing = false;
            for (const property of jsAst.properties) {
              if (property.type !== 'ObjectProperty' || property.method || property.computed) {
                // Can't sanitize getters or methods, or spread elements.
                needsDynamicScrubbing = true;
                break;
              }
              const attrName = property.key.name || property.key.value;
              const { code: valueExpression } = generate(property.value);
              if (!constantinople(valueExpression)) {
                maybeGuardAttributeValue(
                  element, attrName, getValue, valueExpression,
                  // eslint-disable-next-line no-loop-func
                  (newValueExpression) => {
                    changedAst = true;
                    property.value = parseExpression(newValueExpression);
                  });
              }
            }
          }
          // If not all the property names are known, then we need to depend on a scrubber
          // library that picks guards at render time.
          if (needsDynamicScrubbing) {
            attributeBlock.val = addScrubber('scrubAttrs', element, attributeBlock.val);
          } else if (changedAst) {
            attributeBlock.val = generate(jsAst).code;
          }
        }
      },
    };

    // Walk the AST applying the policy
    function apply(x) {
      const policyPathLength = policyPath.length;
      policyPath[policyPathLength] = x;
      if (Array.isArray(x)) {
        for (let i = 0, len = x.length; i < len; ++i) {
          policyPath[policyPathLength + 1] = i;
          apply(x[i]);
        }
      } else if (x && typeof x === 'object') {
        for (const key of Object.getOwnPropertyNames(x)) {
          policyPath[policyPathLength + 1] = key;
          const valueType = typeof policy[key];
          if (valueType === 'function') {
            policy[key](x[key]);
          } else if (valueType === 'object') {
            const policyMember = policy[key][x[key]];
            if (typeof policyMember === 'function') {
              policyMember(x);
            }
          }
          if (key === 'test' || key === 'expr') {
            checkCodeDoesNotInterfere(x, key, true);
          }
          apply(x[key]);
        }
      }
      policyPath.length = policyPathLength;
    }

    apply(ast, []);

    // If mixin f calls fp, and f is in calledInScript,
    // then add fp to calledInSensitiveContext.
    transitiveClosure(calledInSensitiveContext, mixinCallGraph);

    // Worst case analysis!  If a code block appears in the
    // top level of a mixin body, and that body is called from the
    // top level of a <script> element, then guard the code.
    // This may affect uses of the mixin from outside script elements.
    function guardTextInMixins() {
      for (const { mixin, code, tag } of deferred) {
        if (calledInSensitiveContext.has(mixin)) {
          const guards = calledInSensitiveContext.get(mixin);
          if (code) {
            for (const guard of guards) {
              code.val = addGuard(guard, code.val);
              code.mustEscape = false;
            }
          } else if (guards.has(trustedScriptGuard)) {
            distrust(
              `HTML tag <${ tag.name
              }> may appear inside <script> which cannot have tag content via call to +${ mixin }`,
              tag);
          }
        } else if (code) {
          code.val = addGuard(trustedHTMLGuard, code.val);
          code.mustEscape = false;
        }
      }
    }

    guardTextInMixins();

    // Inject the equivalent of
    // - var rt_unpredictableId = ...
    // at the top of the template if it turns out we need it.
    if (mayTrustOutput) {
      ast.nodes.push(
        {
          'type': 'Code',
          'val': `pug_html = rt_${ unpredictableSuffix }.getMinter(require.moduleKeys)(pug_html)`,
          'buffer': false,
          'mustEscape': false,
          'isInline': false,
        });
      needsRuntime = true;
    }
    if (needsScrubber) {
      ast.nodes.splice(
        0, 0,
        {
          'type': 'Code',
          // TODO: How does this affect client-side compilation?
          'val': `var sc_${ unpredictableSuffix } = require('pug-scrubber-trusted-types');`,
          'buffer': false,
          'mustEscape': false,
          'isInline': false,
          'mayRequire': true,
        });
    }
    if (needsRuntime) {
      ast.nodes.splice(
        0, 0,
        {
          'type': 'Code',
          // TODO: How does this affect client-side compilation?
          'val': (
            'require(\'module-keys/cjs\').polyfill(module, require);\n' +
            `var rt_${ unpredictableSuffix } = require('pug-runtime-trusted-types');`
          ),
          'buffer': false,
          'mustEscape': false,
          'isInline': false,
          'mayRequire': true,
        });
    }

    return ast;
  },
});
