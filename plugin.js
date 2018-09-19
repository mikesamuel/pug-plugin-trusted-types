'use strict';

/* eslint { "complexity": [ 2, { max: 15 } ] } */

const crypto = require('crypto');
const path = require('path');

const constantinople = require('constantinople');
const { parseExpression } = require('@babel/parser');
const { default: generate } = require('@babel/generator');

const { contentTypeForElement, typeOfAttribute } = require('./lib/contracts/contracts.js');

/* eslint-disable array-element-newline */
// This relates values from security.html.contracts.AttrType to names
// of functions exported by runtime.js
const GUARDS_BY_ATTRIBUTE_TYPE = [
  // Unused
  null,
  // Not Sensitive
  null,
  // HTML
  'requireTrustedHTML',
  // URL
  'requireTrustedURL',
  // RESOURCE URL
  'requireTrustedResourceURL',
  // TODO STYLE
  null,
  'requireTrustedScript',
  // TODO ENUM
  null,
  // TODO CONSTANT
  'reject',
  // TODO IDENTIFIER
  null,
];

const GUARDS_BY_ELEMENT_CONTENT_TYPE = [
  null,
  null,
  // TODO STYLE
  null,
  'requireTrustedScript',
  'reject',
  'reject',
  // RCDATA is OK
  null,
];
/* eslint-enable array-element-newline */

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

function mayContainTags(elName) {
  elName = elName.toLowerCase();
  return elName !== 'script' && elName !== 'style' && elName !== 'iframe';
}

module.exports = Object.freeze({
  // Hook into PUG just before the AST is converted to JS code.
  preCodeGen(inputAst, options) { // eslint-disable-line no-unused-vars
    // PUG provides no way to forward options to plugins, so we piggyback on
    // filterOptions.
    const report = ((options.filterOptions || {}).trustedTypes || {}).report ||
      // eslint-disable-next-line no-console
      console.warn.bind(console);

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
    let needsScrubbers = false;

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
    function getElementName(skip = 0) {
      for (let i = policyPath.length - (skip * 2); (i -= 2) >= 0;) {
        if (typeof policyPath[i] === 'object' && policyPath[i].type === 'Tag') {
          return policyPath[i].name.toLowerCase();
        }
      }
      return null;
    }

    function getMixinName() {
      for (let i = policyPath.length; (i -= 2) >= 0;) {
        if (typeof policyPath[i] === 'object' &&
            policyPath[i].type === 'Mixin' && !policyPath[i].call) {
          return policyPath[i].name;
        }
      }
      return null;
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
            if (constantinople(attr.value)) {
              const value = constantinople.toConstant(attr.value);
              if (value) {
                values.set(attr.name, value);
              }
            }
          }
          // eslint-disable-next-line no-unused-vars
          for (const attributeBlock of attributeBlocks) {
            // TODO: incorporate constant properties from attributeBlocks
            // into values.
            // TODO: see attributeBlock handler below for way to parse out
            // name/value pairs.
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
      safeExpr = ` tt_${ unpredictableSuffix }.${ guard }(${ expr }) `;
      return safeExpr;
    }

    function addScrubber(scrubber, expr) {
      let safeExpr = null;
      if (!isWellFormed(expr)) {
        expr = '{/*Malformed Expression*/}';
      }
      needsScrubbers = true;
      safeExpr = ` ttrt_${ unpredictableSuffix }.${ scrubber }(${ expr }) `;
      return safeExpr;
    }

    function maybeGuardAttributeValue(
      elementName, attrName, getValue, valueExpression, onNewValue) {
      attrName = String(attrName).toLowerCase();
      const type = typeOfAttribute(elementName || '*', attrName, getValue);
      if (type === null) {
        distrust(`Cannot trust dynamic value for attribute ${ attrName }`);
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
    function checkExpressionDoesNotInterfere(expr) {
      const seen = new Set();
      function check(jsAst) {
        if (jsAst && typeof jsAst === 'object' && jsAst.type === 'Identifier') {
          if (/^pug_/.test(jsAst.name) || jsAst.name === 'eval') {
            distrust(`Expression (${ expr }) may interfere with PUG internals ${ jsAst.name }`);
          }
        }
        if (!seen.has(jsAst) && mayTrustOutput) {
          seen.add(jsAst);
          for (const key in jsAst) {
            if (Object.hasOwnProperty.call(jsAst, key)) {
              check(jsAst[key]);
            }
          }
        }
      }
      if (mayTrustOutput) {
        let jsAst = null;
        try {
          jsAst = parseExpression(expr);
        } catch (exc) {
          distrust(`Malformed expression (${ expr })`);
          return;
        }
        check(jsAst);
      }
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
          checkExpressionDoesNotInterfere(obj.val);
          if (obj.buffer) {
            const elName = getElementName();
            const contentType = contentTypeForElement(elName);
            const guard = contentType ? GUARDS_BY_ELEMENT_CONTENT_TYPE[contentType] : null;
            if (guard) {
              obj.val = addGuard(guard, obj.val);
              obj.mustEscape = false;
            } else if (elName === null) {
              const mixinName = getMixinName();
              if (mixinName) {
                deferred.push({ mixinName, code: obj });
              }
            }
          }
        },
        Comment(obj) {
          if (/--|^-?$/.test(obj.val)) {
            distrust(`Invalid comment content ${ JSON.stringify(obj.val) }`);
          }
        },
        Mixin(obj) {
          if (obj.call) {
            checkExpressionDoesNotInterfere(obj.args);
            const elName = getElementName();
            const contentType = contentTypeForElement(elName);
            const guard = contentType ? GUARDS_BY_ELEMENT_CONTENT_TYPE[contentType] : null;
            if (guard) {
              multiMapSet(calledInSensitiveContext, obj.name, guard);
            } else {
              const mixinName = getMixinName();
              if (mixinName) {
                mixinCallGraph[mixinName] = mixinCallGraph[mixinName] || [];
                mixinCallGraph[mixinName].push(obj.name);
              }
            }
          }
        },
        Tag(obj) {
          const elName = getElementName(1);
          if (elName) {
            if (!mayContainTags(elName)) {
              distrust(`HTML tag <${ obj.name }> appears inside <${ elName }> which cannot have tag content`);
            }
          } else {
            const mixinName = getMixinName();
            if (mixinName) {
              deferred.push({ mixinName, tag: obj });
            }
          }
        },
      },
      attrs(obj) {
        const getValue = valueGetter(policyPath[policyPath.length - 2]);
        const elementName = getElementName();
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
            checkExpressionDoesNotInterfere(attr.val);
            maybeGuardAttributeValue(
              elementName, attr.name, getValue, attr.val,
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
        const elementName = getElementName() || '*';
        const getValue = valueGetter(policyPath[policyPath.length - 2]);
        for (const attributeBlock of obj) {
          checkExpressionDoesNotInterfere(attributeBlock.val);
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
                  elementName, attrName, getValue, valueExpression,
                  // eslint-disable-next-line no-loop-func
                  (newValueExpression) => {
                    changedAst = true;
                    property.value = parseExpression(newValueExpression);
                  });
              }
            }
          }
          if (needsDynamicScrubbing) {
            attributeBlock.val = addScrubber('scrubAttrs', attributeBlock.val);
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
      for (const { mixinName, code, tag } of deferred) {
        if (calledInSensitiveContext.has(mixinName)) {
          const guards = calledInSensitiveContext.get(mixinName);
          if (code) {
            for (const guard of guards) {
              code.val = addGuard(guard, code.val);
              code.mustEscape = false;
            }
          } else if (tag) {
            // TODO: magic string
            if (guards.has('requireTrustedScript')) {
              distrust(
                `HTML tag <${ tag.name
                }> may appear inside <script> which cannot have tag content via call to +${ mixinName }`,
                tag);
            }
          }
        }
      }
    }

    guardTextInMixins();

    // Inject the equivalent of
    // - var unpredictableId = ...
    // at the top of the template if it turns out we need it.
    if (needsScrubbers) {
      ast.nodes.splice(
        0, 0,
        {
          'type': 'Code',
          // TODO: What do we do about client side compilation?
          'val': `var ttrt_${ unpredictableSuffix } = require('pug-runtime-trusted-type/scrubbers.js');`,
          'buffer': false,
          'mustEscape': false,
          'isInline': false,
        });
    }
    if (needsRuntime) {
      ast.nodes.splice(
        0, 0,
        {
          'type': 'Code',
          // TODO: What do we do about client side compilation?
          'val': `var tt_${ unpredictableSuffix } = require('pug-runtime-trusted-type/runtime.js');`,
          'buffer': false,
          'mustEscape': false,
          'isInline': false,
        });
    }

    if (mayTrustOutput) {
      ast.nodes.push(
        {
          'type': 'Code',
          'val': 'pug_html = pug_uncheckedConversionToTrustedHtml(pug_html)',
          'buffer': false,
          'mustEscape': false,
          'isInline': false,
        });
    }
    return ast;
  },
});
