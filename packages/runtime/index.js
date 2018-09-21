'use strict';

/**
 * @fileoverview
 * The pug-plugin-trusted-types sibling project generates calls to
 * these functions which check that values are safe in context before
 * they are interpolated into the HTML output.
 */

const {
  TrustedHTML,
  TrustedResourceURL,
  TrustedScript,
  TrustedURL,
} = require('web-contract-types');


const requireTrustedHTML = TrustedHTML.escape;

const innocuousTrustedResourceURL = TrustedResourceURL.innocuousURL;
function requireTrustedResourceURL(val) {
  return TrustedResourceURL.is(val) ? val : innocuousTrustedResourceURL;
}

const { innocuousScript } = TrustedScript;
function requireTrustedScript(val) {
  return TrustedScript.is(val) ? val : innocuousScript;
}

function requireTrustedURL(val) {
  return TrustedURL.sanitize(val);
}


module.exports = Object.freeze({
  requireTrustedHTML,
  requireTrustedResourceURL,
  requireTrustedScript,
  requireTrustedURL,
});
