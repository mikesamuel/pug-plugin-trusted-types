'use strict';

const { typeOfAttribute } = require('pug-contracts-trusted-types');

const {
  reject,
  requireTrustedHTML,
  requireTrustedResourceURL,
  requireTrustedScript,
  requireTrustedURL,
} = require('pug-runtime-trusted-types');

const { create, hasOwnProperty } = Object;
const { apply } = Reflect;
const { toLowerCase } = String.prototype;

const {
  GUARDS_BY_ATTRIBUTE_TYPE,
} = require('pug-guards-trusted-types');

const GUARDS = {
  __proto__: null,
  reject,
  requireTrustedHTML,
  requireTrustedResourceURL,
  requireTrustedScript,
  requireTrustedURL,
};

const noArgs = [];

function lcase(str) {
  return apply(toLowerCase, str, noArgs);
}

function scrubAttrs(elementName, attrs) {
  const outputAttrs = create(null);
  // This loop mimics a loop in pug.attrs().
  for (const attrName in attrs) {
    if (apply(hasOwnProperty, attrs, [ attrName ])) {
      // We have to copy values over to avoid polymorphic input attacks.
      const lcAttrName = lcase(attrName);
      if (lcAttrName !== '__proto__') {
        outputAttrs[lcAttrName] = attrs[attrName];
      }
    }
  }
  function getValue(attrName) {
    if (!(attrName in outputAttrs)) {
      return null;
    }
    const value = `${ outputAttrs[attrName] }`;
    // Reinsert value into output array after stringifying to avoid
    // pug.attrs from seeing different values due to non-repeatable
    // toString / valueOf invocations.
    outputAttrs[attrName] = value;
    return value;
  }
  for (const attrName in outputAttrs) {
    const value = outputAttrs[attrName];
    const type = typeOfAttribute(elementName, attrName, getValue);
    const guard = GUARDS_BY_ATTRIBUTE_TYPE[type];
    if (guard) {
      const guardFn = GUARDS[guard];
      outputAttrs[attrName] = guardFn(value);
    }
  }
  return outputAttrs;
}

module.exports = Object.freeze({ scrubAttrs });
