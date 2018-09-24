'use strict';

const { addHook } = require('pirates');
const { compileClientWithDependenciesTracked } = require('pug');
const stringify = require('js-stringify');

const { assign } = Object;

let config = {};

function compilePugToModule(code, filename) {
  const optionsForFile = assign(
    {},
    { filename },
    config);
  const { body } = compileClientWithDependenciesTracked(code, optionsForFile);
  const name = optionsForFile.name || 'template';
  // Pack the prologue onto one line to preserve line numbers as apparent to pug-codegen.
  return `'use strict'; require('module-keys/cjs').polyfill(module, require, ${ stringify(filename) }); ${ body }

module.exports = ${ name };`;
}

function configurePug(pugOptions) {
  config = pugOptions;
}

let revertFn = null;

function reinstall() {
  if (!revertFn) {
    revertFn = addHook(
      compilePugToModule,
      {
        exts: [ '.pug' ],
      });
  }
}

function uninstall() {
  const revert = revertFn;
  revertFn = null;
  if (revert) {
    revert();
  }
}

module.exports = {
  configurePug,
  reinstall,
  uninstall,
};

reinstall();
