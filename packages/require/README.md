# Pug Require

[![npm](https://img.shields.io/npm/v/pug-require.svg)](https://www.npmjs.com/package/pug-require)

Allows compiling and loading [Pug](https://pugjs.org) templates via `require('./path/to/template.pug')`.

<!-- TOC -->
*  [Installation](#hdr-installation)
*  [Usage](#hdr-usage)
*  [API](#hdr-api)
   *  [configurePug(pugOptions)](#hdr-configurepug-pugoptions-)
   *  [uninstall()](#hdr-uninstall-)
   *  [reinstall()](#hdr-reinstall-)

<!-- /TOC -->

## Installation                         <a name="hdr-installation"></a>

```bash
$ npm install pug-require
```

## Usage                                <a name="hdr-usage"></a>

```js
// Install hooks
const configurePug = require('pug-require');

configurePug({ /* pug options */ });

// Compile template
const pugTemplateFunction = require('./path/to/template.pug');

// Use template
const html = pugTemplateFunction({ /* local variables */ });
```

## API                                  <a name="hdr-api"></a>

### configurePug(pugOptions)            <a name="hdr-configurepug-pugoptions-"></a>

pugOptions : A Pug [options bundle](https://pugjs.org/api/reference.html#options)

Regardless of options, attaches the [trusted types plugin][].

### uninstall()                         <a name="hdr-uninstall-"></a>

Detaches the Pug hook.

A no-op if not currently installed.

### reinstall()                         <a name="hdr-reinstall-"></a>

Undoes a call to `uninstall`.

A no-op if already installed.


[trusted types plugin]: https://npmjs.com/package/pug-plugin-trusted-types
