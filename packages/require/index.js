'use strict';

const { addHook } = require('pirates');
const { compileClientWithDependenciesTracked } = require('pug');
const stringify = require('js-stringify');

const { assign, create, hasOwnProperty } = Object;
const { apply } = Reflect;

let config = create(null);

function compilePugToModule(code, filename) {
  const optionsForFile = assign(
    create(null),
    { filename },
    config);
  const { body } = compileClientWithDependenciesTracked(code, optionsForFile);
  let name = `${ optionsForFile.name || 'template' }`;
  if (!/^\w+$/.test(name)) {
    name = 'template';
    optionsForFile.name = name;
  }

  // Pack the prologue onto one line to preserve line numbers as apparent to pug-codegen.
  return `'use strict'; require('module-keys/cjs').polyfill(module, require, ${ stringify(filename) }); ${ body }

module.exports = ${ name };`;
}

function configurePug(pugOptions) {
  if (apply(hasOwnProperty, pugOptions, [ '__proto__' ])) {
    // __proto__ interacts badly with Object.assign
    throw new Error();
  }
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
