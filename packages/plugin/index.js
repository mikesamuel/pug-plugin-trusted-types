'use strict';

/* eslint { "complexity": [ 2, { max: 15 } ] } */

const crypto = require('crypto');
const path = require('path');

const constantinople = require('constantinople');
const stringify = require('js-stringify');
const { parseExpression } = require('@babel/parser');
const { default: generate } = require('@babel/generator');

const { contentTypeForElement, typeOfAttribute } = require('pug-contracts-trusted-types');
const {
  trustedHTMLGuard,
  trustedScriptGuard,
  GUARDS_BY_ATTRIBUTE_TYPE,
  GUARDS_BY_ELEMENT_CONTENT_TYPE,
} = require('pug-guards-trusted-types');

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
  String.raw`|<!--[\s\S]--(?:[^>]|$)` +
  // Short comments are lexical corner cases.
  String.raw`<!---?(?:>|$)` +
  // Unclosed pseudo comments.
  String.raw`|<(?:[?]|!(?!--))[^>]*$`);

module.exports = Object.freeze({
  // Hook into PUG just before the AST is converted to JS code.
  // eslint-disable-next-line func-name-matching, no-unused-vars
  preCodeGen: function enforceTrustedTypes(inputAst, options) {
    // PUG provides no way to forward options to plugins, so we piggyback on
    // filterOptions.
    const ttOptions = (options.filterOptions || {}).trustedTypes || {};
    // eslint-disable-next-line no-console
    const report = ttOptions.report || console.warn.bind(console);

    let ast = null;
    let unpredictableSuffix = null;
    {
      // Defensively copy.
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
    // current value.
    const policyPath = [];

    // Don't convert the output as TrustedHTML if the template uses known unsafe
    // features.
    let mayTrustOutput = true;

    function distrust(msg, optAstNode) {
      const { filename, line } = optAstNode || policyPath[policyPath.length - 2] || {};
      const relfilename = options.basedir ? path.relative(options.basedir, filename) : filename;
      report(`${ relfilename }:${ line }: ${ msg }`);
      mayTrustOutput = false;
    }

    // Walk upwards to find the enclosing tag.
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
          for (const attr of attrs) {
            if (constantinople(attr.val)) {
              const value = constantinople.toConstant(attr.val);
              if (value) {
                values.set(attr.name, value);
              }
            }
          }
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
                  const value = constantinople.toConstant(valueExpression);
                  values.set(attrName, value);
                }
              }
            }
          }
        }

        name = String(name).toLowerCase();
        return values.get(name);
      };
    }

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

    function addScrubber(scrubber, element, expr) {
      let safeExpr = null;
      if (!isWellFormed(expr)) {
        expr = '{/*Malformed Expression*/}';
      }
      needsScrubber = true;
      safeExpr = ` sc_${ unpredictableSuffix }.${ scrubber }(${ stringify(element || '*') }, ${ expr }) `;
      return safeExpr;
    }

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
    function checkExpressionDoesNotInterfere(astNode, exprKey) {
      const expr = astNode[exprKey];
      const seen = new Set();

      let warnedPug = false;
      let warnedModule = false;

      function check(jsAst) {
        if (jsAst && typeof jsAst === 'object' && jsAst.type === 'Identifier') {
          const { name } = jsAst;
          if (/^pug_/.test(name) || name === 'eval') {
            if (!warnedPug) {
              distrust(`Expression (${ expr }) may interfere with PUG internals ${ jsAst.name }`);
              warnedPug = true;
            }
          } else if (name === 'require' &&
                     !(Object.hasOwnProperty.call(astNode, 'mayRequire') && astNode.mayRequire)) {
            // We trust trusted plugin code and PUG code to use the module's private key
            // but not template code.
            if (!warnedModule) {
              distrust(`Expression (${ expr }) may interfere with module internals ${ jsAst.name }`);
              astNode[exprKey] = 'null';
              warnedModule = true;
            }
          }
        }
        if (!seen.has(jsAst)) {
          seen.add(jsAst);
          for (const key in jsAst) {
            if (Object.hasOwnProperty.call(jsAst, key)) {
              check(jsAst[key]);
            }
          }
        }
      }
      let root = null;
      try {
        root = parseExpression(expr);
      } catch (exc) {
        distrust(`Malformed expression (${ expr })`);
        return;
      }
      check(root);
    }

    // Keys match keys in the AST.  The input is the referent of policyPath.
    const policy = {
      __proto__: null,
      type: {
        __proto__: null,
        Code(obj) {
          if (constantinople(obj.val)) {
            return;
          }
          checkExpressionDoesNotInterfere(obj, 'val');
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
          if (/--|^-?$/.test(obj.val)) {
            distrust(`Invalid comment content ${ JSON.stringify(obj.val) }`);
          }
        },
        Mixin(obj) {
          if (obj.call) {
            if (/\S/.test(obj.args)) {
              checkExpressionDoesNotInterfere(obj, 'args');
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
          const { element, mixin } = getContainerName(1);
          if (element) {
            if (!mayContainTags(element)) {
              distrust(`HTML tag <${ obj.name }> appears inside <${ element }> which cannot have tag content`);
            }
          } else if (mixin) {
            deferred.push({ mixin, tag: obj });
          }
        },
        Text(obj) {
          if (obj.isHtml) {
            const match = MALFORMED_MARKUP.exec(obj.val);
            if (match) {
              distrust(`Malformed HTML markup ${ match[0] }`);
            }
          }
        },
      },
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
                distrust(`Attribute value ${ constant } breaks attribute quoting`);
              }
            }
          } else {
            checkExpressionDoesNotInterfere(attr, 'val');
            maybeGuardAttributeValue(
              element, attr.name, getValue, attr.val,
              (guardedExpression) => {
                attr.val = guardedExpression;
              });
            if (!attr.mustEscape) {
              distrust('Attribute value must be escaped');
            }
          }
        }
      },
      attributeBlocks(obj) {
        const parent = policyPath[policyPath.length - 2];
        const getValue = valueGetter(parent);
        // If the attributes appear directly on a call, do not assume any containing
        // element context
        const element = parent.call ? null : getContainerName().element;
        for (const attributeBlock of obj) {
          checkExpressionDoesNotInterfere(attributeBlock, 'val');
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
          'val': `pug_html = rt_${ unpredictableSuffix }.getMinter(require.keys)(pug_html)`,
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
          // TODO: What do we do about client side compilation?
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
          // TODO: What do we do about client side compilation?
          'val': `var rt_${ unpredictableSuffix } = require('pug-runtime-trusted-types');`,
          'buffer': false,
          'mustEscape': false,
          'isInline': false,
          'mayRequire': true,
        });
    }

    return ast;
  },
});
