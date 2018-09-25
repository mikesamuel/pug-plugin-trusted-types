# Pug Require

[![npm](https://img.shields.io/npm/v/pug-require.svg)](https://www.npmjs.com/package/pug-require)

Allows compiling and loading [Pug](https://pugjs.org) templates via `require('./path/to/template.pug')`.

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

Regardless of options, attaches the [trusted types plugin][].

### uninstall()

Detaches the Pug hook.

A no-op if not currently installed.

### reinstall()

Undoes a call to `uninstall`.

A no-op if already installed.


[trusted types plugin]: https://npmjs.com/package/pug-plugin-trusted-types
