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

function scrubAttrs(elementName, attrs) {
  const outputAttrs = create(null);
  // This loop mimics a loop in pug.attrs().
  for (const attrName in attrs) {
    if (apply(hasOwnProperty, attrs, [ attrName ])) {
      // We have to copy value over to avoid polymorphic input attacks.
      if (attrName !== '__proto__') {
        outputAttrs[attrName] = attrs[attrName];
      }
    }
  }
  function getValue(attrName) {
    return `${ outputAttrs[attrName] }`;
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
