# Pug Require

[![npm](https://img.shields.io/npm/v/pug-require.svg)](https://www.npmjs.com/package/pug-require)
[![Install Size](https://packagephobia.now.sh/badge?p=pug-require)](https://packagephobia.now.sh/result?p=pug-require)

Allows compiling and loading [Pug](https://pugjs.org) templates via `require('./path/to/template.pug')`.

This makes it easy to use Pug with plugins that need to be able to
`require` support code.
For example, the [trusted types](https://npmjs.com/pug-plugin-trusted-types)
plugin *\</shameless-plug\>*.

## Installation

```bash
$ npm install pug-require
```

## Usage

```js
// Install hooks
const configurePug = require('pug-require');

configurePug({ /* pug options */ });

// Compile template
const pugTemplateFunction = require('./path/to/template.pug');

// Use template
const html = pugTemplateFunction({ /* local variables */ });
```

## API

### configurePug(pugOptions)

pugOptions : A Pug [options bundle](https://pugjs.org/api/reference.html#options)

### uninstall()

Detaches the Pug hook.

A no-op if not currently installed.

### reinstall()

Undoes a call to `uninstall`.

A no-op if already installed.
