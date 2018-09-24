'use strict';

/**
 * @fileoverview
 * The pug-plugin-trusted-types sibling project generates calls to
 * these functions which check that values are safe in context before
 * they are interpolated into the HTML output.
 */

const { Mintable } = require('node-sec-patterns');

const {
  TrustedHTML,
  TrustedResourceURL,
  TrustedScript,
  TrustedURL,
} = require('web-contract-types');


function reject() {
  return ' ';
}

function trueFn() {
  return true;
}

function identity(x) {
  return x;
}

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

function getMinter({ unbox }) {
  return unbox(
    Mintable.minterFor(TrustedHTML),
    trueFn,
    identity);
}


module.exports = Object.freeze({
  getMinter,
  reject,
  requireTrustedHTML,
  requireTrustedResourceURL,
  requireTrustedScript,
  requireTrustedURL,
});
