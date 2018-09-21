<img align="right" src="https://cdn.rawgit.com/mikesamuel/template-tag-common/7f0159bda72d616af30645d49c3c9203c963c0a6/images/logo.png" alt="Sisyphus Logo">

# Pug Trusted Types Plugin

[![Build Status](https://travis-ci.org/mikesamuel/pug-plugin-trusted-types.svg?branch=master)](https://travis-ci.org/mikesamuel/pug-plugin-trusted-types)
[![Dependencies Status](https://david-dm.org/mikesamuel/pug-plugin-trusted-types/status.svg)](https://david-dm.org/mikesamuel/pug-plugin-trusted-types)
[![npm](https://img.shields.io/npm/v/pug-plugin-trusted-types.svg)](https://www.npmjs.com/package/pug-plugin-trusted-types)
[![Coverage Status](https://coveralls.io/repos/github/mikesamuel/pug-plugin-trusted-types/badge.svg?branch=master)](https://coveralls.io/github/mikesamuel/pug-plugin-trusted-types?branch=master)
[![Install Size](https://packagephobia.now.sh/badge?p=pug-plugin-trusted-types)](https://packagephobia.now.sh/result?p=pug-plugin-trusted-types)
[![Known Vulnerabilities](https://snyk.io/test/github/mikesamuel/pug-plugin-trusted-types/badge.svg?targetFile=package.json)](https://snyk.io/test/github/mikesamuel/pug-plugin-trusted-types?targetFile=package.json)

Hooks into [Pug](https://pugjs.org) to add
[Trusted Types](https://github.com/WICG/trusted-types) checks to key attributes
to reduce the risk of XSS.

This plugin focuses on checking URLs, to prevent, e.g. arbitrary strings from reaching `<script src>` or
`javascript:` URLs from reaching `<a href>`.

This plugin cannot, by itself, prevent XSS due to
[intentionally unsafe features](https://pugjs.org/language/code.html#unescaped-buffered-code).


## Installation

```bash
$ npm install pug-plugin-trusted-types
```

If you precompile PUG templates to JS then you can install it as a dev
dependency by adding `--save-dev`.

## Usage

Add the plugin to the `plugins` field of your Pug options object.

### Before

```js
const pug = require('pug');

const myTemplate = pug.compile(
    templateCode,
    {
      // Options
    });
```

### After

```js
const pug = require('pug');
const pugPluginTT = require('pug-plugin-trusted-types/plugin');

const myTemplate = pug.compile(
    templateCode,
    {
      plugins: [ pugPluginTT ],
      // Options
    });
```

Since the Trusted Types Plugin provides security checks, it should ideally
run *after* plugins that do not aim to provide security guarantees.
Putting it at the end of any existing `plugins` array should suffice.
