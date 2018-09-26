'use strict';

const { randomBytes } = require('crypto');
const path = require('path');

const ttPlugin = require('pug-plugin-trusted-types');
const {
// calledAsTemplateTagQuick,
  memoizedTagFunction,
  trimCommonWhitespaceFromLines,
} = require('template-tag-common');
const { compileClientWithDependenciesTracked } = require('pug');
const stringify = require('js-stringify');

const { isArray } = Array;
const { assign, create, entries, hasOwnProperty } = Object;
const { apply } = Reflect;


function allocateNonce() {
  // eslint-disable-next-line no-magic-numbers
  return randomBytes(32).toString('hex');
}

function abbrevLeft(str) {
  const [ whole, abbrev ] =
    /(?:^|[\s\S])((?:[^\ud800-\udfff]|[\ud800-\udbff][\udc00-\udfff]){0,10})$/.exec(str);
  return (whole.length === abbrev.length) ? whole : `...${ abbrev }`;
}

function abbrevRight(str) {
  const [ whole, abbrev ] =
    /^((?:[^\ud800-\udfff]|[\ud800-\udbff][\udc00-\udfff]){0,10})(?:[\s\S]|$)/.exec(str);
  return (whole.length === abbrev.length) ? whole : `${ abbrev }...`;
}

function computeStaticHelper(strings) {
  if (strings.length !== 1) {
    throw new Error(
      `Interpolating pug code into a template is an XSS risk: ${
        abbrevLeft(strings[0]) }$${ '{x}' }${ abbrevRight(strings[1]) }`);
  }
  strings = trimCommonWhitespaceFromLines(
    strings, { trimEolAtStart: true, trimEolAtEnd: true });
  return strings[0];
}

function getCallerInfo() {
  let lineOffset = 0;
  let filename = 'inline-pug.js';
  try {
    throw new Error();
  } catch (exc) {
    const lines = exc.stack.split('\n');
    const match = /([^)]*):(\d+):\d+\)$/
      // Offset 4 determined empirically
      // eslint-disable-next-line no-magic-numbers
      .exec(lines[4]);
    if (match) {
      [ , filename, lineOffset ] = match;
      lineOffset -= 0;
    }
  }
  return { lineOffset, filename };
}

function makeRestackPlugin({ lineOffset, filename }) {
  return {
    // eslint-disable-next-line func-name-matching
    postLoad: function rewriteFilePositions(root) {
      function walk(ast) {
        if (typeof ast.line === 'number' && typeof ast.filename === 'string') {
          ast.line += lineOffset;
          ast.filename = filename;
        }
        for (const [ , child ] of entries(ast)) {
          if (child && typeof child === 'object') {
            walk(child);
          }
        }
      }
      walk(root);
      return root;
    },
  };
}

function computeResultHelper(options, pugSource) {
  if (!(options && typeof options === 'object')) {
    options = {};
  }
  if (apply(hasOwnProperty, options, [ '__proto__' ])) {
    // __proto__ interacts badly with assign.
    throw new Error();
  }

  const callerInfo = getCallerInfo();

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
  plugins[plugins.length] = makeRestackPlugin(callerInfo);

  const nonce = allocateNonce();
  const basename = `template-${ nonce }.js`;
  const moduleId = `${ module.id.replace(/[^/]*$/, '') }${ basename }`;
  const filename = path.join(path.dirname(module.filename), basename);

  const augOptions = assign(
    create(null),
    options,
    {
      name: 'template',
      plugins,
      filename,
    });

  const { body } = compileClientWithDependenciesTracked(pugSource, augOptions);

  // Pack the prologue onto one line to preserve line numbers as apparent to pug-codegen.
  const descStr = stringify(`@pug/template-${ nonce }`);
  const content = `'use strict'; require('module-keys/cjs').polyfill(module, require, ${ descStr }); ${ body }

module.exports = template;`;

  const pugModule = new (module.constructor)(moduleId, module);
  pugModule.loaded = true;
  pugModule.filename = filename;
  pugModule.paths = [ ...module.paths ];

  // eslint-disable-next-line no-underscore-dangle
  pugModule._compile(content, callerInfo.filename);
  return pugModule.exports;
}

module.exports = memoizedTagFunction(computeStaticHelper, computeResultHelper);
