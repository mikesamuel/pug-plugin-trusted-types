'use strict';

const { addHook } = require('pirates');
const { compileClientWithDependenciesTracked } = require('pug');

const { isArray } = Array;
const { assign, create, hasOwnProperty } = Object;
const { apply } = Reflect;

const ttPlugin = require('pug-plugin-trusted-types');

let config = null;

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
  return `'use strict'; require('module-keys/cjs').polyfill(module, require); ${ body }

module.exports = ${ name };`;
}

function configurePug(options) {
  if (!(options && typeof options === 'object')) {
    options = {};
  }
  if (apply(hasOwnProperty, options, [ '__proto__' ])) {
    throw new Error('__proto__ interacts badly with Object.assign');
  }

  const givenPlugins = options.plugins;
  const plugins = isArray(givenPlugins) ? [ ...givenPlugins ] : [];
  let addTtPlugin = true;
  for (let i = 0, len = plugins.length; i < len; ++i) {
    if (plugins[i] === ttPlugin) {
      addTtPlugin = false;
      break;
    }
  }
  if (addTtPlugin) {
    plugins[plugins.length] = ttPlugin;
  }

  config = assign(create(null), options, { plugins });
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

configurePug({});
reinstall();
