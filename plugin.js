'use strict';

const crypto = require('crypto');
const constantinople = require('constantinople');
const stringify = require('js-stringify');

const { typeOfAttribute } = require('./lib/contracts/contracts.js');

// This relates values from security.html.contracts.AttrType to names
// of functions exported by runtime.js
const GUARDS_BY_ATTRIBUTE_TYPE = [
  /* eslint-disable array-element-newline */
  // Unused
  null,
  // Not Sensitive
  null,
  // HTML
  'requireTrustedHtml',
  // URL
  'requireTrustedUrl',
  // RESOURCE URL
  'requireTrustedResourceUrl',
  // TODO STYLE
  null,
  'requireTrustedScript',
  // TODO ENUM
  null,
  // TODO CONSTANT
  null,
  // TODO IDENTIFIER
  null,
  /* eslint-enable array-element-newline */
];

function transitiveClosure(nodeLabels, graph) {
  let madeProgress = false;
  do {
    madeProgress = false;
    for (const src of Array.from(nodeLabels)) {
      const targets = graph[src];
      if (targets) {
        for (const target of targets) {
          if (!nodeLabels.has(target)) {
            madeProgress = true;
            nodeLabels.add(target);
          }
        }
      }
    }
  } while (madeProgress);
}

module.exports = Object.freeze({
  // Hook into PUG just before the AST is converted to JS code.
  preCodeGen(inputAst, options) { // eslint-disable-line no-unused-vars
    let ast = null;
    let unpredictableId = null;
    {
      // Defensively copy.
      const astJson = JSON.stringify(inputAst);
      ast = JSON.parse(astJson);
      // Produce a stable but unguessable ID so we can get unmaskable access
      // to our runtime support code.
      const unpredictableIdHash = crypto.createHash('sha256');
      unpredictableIdHash.update(astJson);
      unpredictableId = `tt_${ unpredictableIdHash.digest('hex') }`;
    }

    // If we make any changes, we'll inject runtime support.
    let needsRuntime = false;

    // Keep track of the mixin call graph and which are called in sensitive
    // contexts.
    const deferredTextCode = [];
    const calledInScript = new Set();
    // Maps each name of a mixin to the names of mixins it calls in a text context.
    const mixinCallGraph = Object.create(null);

    // A sequence of (object, key) pairs that were traversed to reach the
    // current value.
    const path = [];

    // Walk upwards to find the enclosing tag.
    function getElementName() {
      for (let i = path.length; (i -= 2) >= 0;) {
        if (typeof path[i] === 'object' && path[i].type === 'Tag') {
          return path[i].name.toLowerCase();
        }
      }
      return null;
    }

    function getMixinName() {
      for (let i = path.length; (i -= 2) >= 0;) {
        if (typeof path[i] === 'object' &&
            path[i].type === 'Mixin' && !path[i].call) {
          return path[i].name;
        }
      }
      return null;
    }

    // Decorate expression text with a call to a guard function.
    function addGuard(guard, expr) {
      let wellFormed = true;
      try {
        // Should throw if attr.val is not well-formed.
        // eslint-disable-next-line no-new, no-new-func
        new Function(`return () => (${ expr })`);
      } catch (exc) {
        // eslint-disable-next-line no-console
        console.error(`Malformed expression in Pug template: ${ expr }`);
        wellFormed = false;
      }
      let safeExpr = null;
      if (wellFormed) {
        needsRuntime = true;
        safeExpr = ` ${ unpredictableId }.${ guard }(${ expr }) `;
      } else {
        safeExpr = stringify('about:invalid#malformed-input');
      }
      return safeExpr;
    }

    // Keys match keys in the AST.  The input is the referent of path.
    const policy = {
      __proto__: null,
      type: {
        __proto__: null,
        Code(obj) {
          if (!constantinople(obj.val)) {
            const elName = getElementName();
            if (elName === 'script') {
              obj.val = addGuard('requireTrustedScript', obj.val);
              obj.mustEscape = false;
            } else if (elName === null) {
              const mixinName = getMixinName();
              if (mixinName) {
                deferredTextCode.push({ mixinName, code: obj });
              }
            }
          }
        },
        Mixin(obj) {
          if (obj.call) {
            const elName = getElementName();
            if (elName === 'script') {
              calledInScript.add(obj.name);
            } else {
              const mixinName = getMixinName();
              if (mixinName) {
                mixinCallGraph[mixinName] = mixinCallGraph[mixinName] || [];
                mixinCallGraph[mixinName].push(obj.name);
              }
            }
          }
        },
      },
      attrs(obj) {
        // Sometimes the type for one attribute depends on another.
        // For example, the sensitivity of <link href> depends on
        // the value of rel.
        let values = null;
        function getValue(name) {
          name = String(name).toLowerCase();
          if (!values) {
            values = new Map();
          }
          for (const attr of obj) {
            if (constantinople(attr.value)) {
              const value = constantinople.toConstant(attr.value);
              if (value) {
                values.set(name, value);
              }
            }
          }
          return values.get(name);
        }

        // Iterate over attributes and add checks as necessary.
        for (const attr of obj) {
          if (constantinople(attr.val)) {
            continue;
          }
          const canonName = String(attr.name).toLowerCase();
          const type = typeOfAttribute(getElementName() || '*', canonName, getValue);
          const guard = GUARDS_BY_ATTRIBUTE_TYPE[type];
          if (guard) {
            attr.val = addGuard(guard, attr.val);
          }
        }
      },
    };

    // Walk the AST applying the policy
    function apply(x) {
      const pathLength = path.length;
      path[pathLength] = x;
      if (Array.isArray(x)) {
        for (let i = 0, len = x.length; i < len; ++i) {
          path[pathLength + 1] = i;
          apply(x[i]);
        }
      } else if (x && typeof x === 'object') {
        for (const key of Object.getOwnPropertyNames(x)) {
          path[pathLength + 1] = key;
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
      path.length = pathLength;
    }

    apply(ast, []);

    // If mixin f calls fp, and f is in calledInScript,
    // then add fp to calledInScript.
    transitiveClosure(calledInScript, mixinCallGraph);

    // Worst case analysis!  If a code block appears in the
    // top level of a mixin body, and that body is called from the
    // top level of a <script> element, then guard the code.
    // This may affect uses of the mixin from outside script elements.
    function guardTextInMixins() {
      for (const { mixinName, code } of deferredTextCode) {
        if (calledInScript.has(mixinName)) {
          code.val = addGuard('requireTrustedScript', code.val);
          code.mustEscape = false;
        }
      }
    }

    guardTextInMixins();

    // Inject the equivalent of
    // - var unpredictableId = ...
    // at the top of the template if it turns out we need it.
    if (needsRuntime) {
      ast.nodes.splice(
        0, 0,
        {
          'type': 'Code',
          // TODO: What do we do about client side compilation?
          'val': `var ${ unpredictableId } = require('pug-plugin-trusted-type/runtime.js');`,
          'buffer': false,
          'mustEscape': false,
          'isInline': false,
        });
    }
    return ast;
  },
});
