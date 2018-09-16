'use strict';

const crypto = require('crypto');
const constantinople = require('constantinople');
const stringify = require('js-stringify');

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

    // A sequence of (object, key) pairs that were traversed to reach the
    // current value.
    const path = [];

    // Keys match keys in the AST.  The input is the referent of path.
    const policy = {
      __proto__: null,
      attrs(obj) {
        for (const attr of obj) {
          // TODO: use polymer-resin/lib/contracts.js
          if (attr.name === 'href' && !constantinople(attr.val)) {
            let safeExpr = attr.val;
            let wellFormed = true;
            try {
              // Should throw if attr.val is not well-formed.
              // eslint-disable-next-line no-new, no-new-func
              new Function(`return () => (${ safeExpr })`);
            } catch (exc) {
              // eslint-disable-next-line no-console
              console.error(`Malformed expresison ${ safeExpr }`);
              wellFormed = false;
            }
            if (wellFormed) {
              needsRuntime = true;
              safeExpr = `${ unpredictableId }.requireTrustedUrl(${ safeExpr })`;
            } else {
              safeExpr = stringify('about:invalid#malformed-input');
            }
            attr.val = safeExpr;
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
          if (typeof policy[key] === 'function') {
            policy[key](x[key]);
          }
          apply(x[key]);
        }
      }
      path.length = pathLength;
    }

    apply(ast, []);

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
