'use strict';

// Names of functions exported by the runtime package.
const trustedHTMLGuard = 'requireTrustedHTML';
const trustedScriptGuard = 'requireTrustedScript';

/* eslint-disable array-element-newline */
// This relates values from security.html.contracts.AttrType to names
// of functions exported by runtime.js
const GUARDS_BY_ATTRIBUTE_TYPE = Object.freeze([
  // Unused
  null,
  // Not Sensitive
  null,
  // HTML
  trustedHTMLGuard,
  // URL
  'requireTrustedURL',
  // RESOURCE URL
  'requireTrustedResourceURL',
  // TODO STYLE
  null,
  trustedScriptGuard,
  // TODO ENUM
  null,
  // TODO CONSTANT
  'reject',
  // TODO IDENTIFIER
  null,
]);

const GUARDS_BY_ELEMENT_CONTENT_TYPE = Object.freeze([
  null,
  null,
  // TODO STYLE
  null,
  trustedScriptGuard,
  'reject',
  'reject',
  // RCDATA is OK
  null,
]);
/* eslint-enable array-element-newline */

module.exports = Object.freeze({
  trustedHTMLGuard,
  trustedScriptGuard,
  GUARDS_BY_ATTRIBUTE_TYPE,
  GUARDS_BY_ELEMENT_CONTENT_TYPE,
});
