<img align="right" src="https://cdn.rawgit.com/mikesamuel/template-tag-common/7f0159bda72d616af30645d49c3c9203c963c0a6/images/logo.png" alt="Sisyphus Logo">

# Safe Pug Templates (Pug Trusted Types Plugin)

[![Build Status](https://travis-ci.org/mikesamuel/pug-plugin-trusted-types.svg?branch=master)](https://travis-ci.org/mikesamuel/pug-plugin-trusted-types)
[![Dependencies Status](https://david-dm.org/mikesamuel/pug-plugin-trusted-types/status.svg)](https://david-dm.org/mikesamuel/pug-plugin-trusted-types)
[![npm](https://img.shields.io/npm/v/pug-plugin-trusted-types.svg)](https://www.npmjs.com/package/pug-plugin-trusted-types)
[![Coverage Status](https://coveralls.io/repos/github/mikesamuel/pug-plugin-trusted-types/badge.svg?branch=master)](https://coveralls.io/github/mikesamuel/pug-plugin-trusted-types?branch=master)
[![Install Size](https://packagephobia.now.sh/badge?p=pug-plugin-trusted-types)](https://packagephobia.now.sh/result?p=pug-plugin-trusted-types)
[![Known Vulnerabilities](https://snyk.io/test/github/mikesamuel/pug-plugin-trusted-types/badge.svg?targetFile=package.json)](https://snyk.io/test/github/mikesamuel/pug-plugin-trusted-types?targetFile=package.json)

Hooks into [Pug](https://pugjs.org) to add
[Trusted Types](https://github.com/WICG/trusted-types) checks to key attributes
to reduce the risk of XSS.

<!-- TOC -->
*  [Usage](#hdr-usage)
   *  [Requiring Templates](#hdr-requiring-templates)
   *  [Inline Templates](#hdr-inline-templates)
   *  [Pre-compiled or manually compiled Templates](#hdr-pre-compiled-or-manually-compiled-templates)
      *  [Before](#hdr-before)
      *  [After](#hdr-after)
*  [Double checking expressions](#hdr-double-checking-expressions)

<!-- /TOC -->

This plugin focuses on checking URLs, to prevent, e.g. arbitrary strings from reaching `<script src>` or
`javascript:` URLs from reaching `<a href>`.

This plugin cannot, by itself, prevent XSS due to
[intentionally unsafe features](https://pugjs.org/language/code.html#unescaped-buffered-code).

Without this plugin, the below can lead to XSS.

```js
// Attacker controls x
const x = 'javascript:alert(document.domain)';

// Declare a template
const pug = require('pug');
const template = pug.compile('a(href=x) Link', {});

// Use the template
const html = template({ x });

console.log(html);
//! <a href="javascript:alert(document.domain)">Link</a>
```


## Usage                                <a name="hdr-usage"></a>

There are several ways to use safe Pug templates.

The Trusted Types plugin adds `require` calls which only work with
code loaded in a CommonJS module context.

Pug compiles templates to JavaScript which it loads by
[calling `new Function()`][pug-compile-code-snippet] so does not
load in a module context.

### Requiring Templates                 <a name="hdr-requiring-templates"></a>

First you need a dependency:

```sh
npm install --save pug-require
```

Then you can load Pug templates by calling `require`.

```js
// Adds hooks so that requiring a .pug file loads it as a template.
// Even if you use the default config, you still need to require
// this module before you require the first .pug file.
const { configurePug } = require('pug-require');

configurePug({ /* pug options */ });

// Load a simple template `a(href=x) Link`.
const myTemplate = require('./templates/link.pug');

console.log(myTemplate({ x: 'https://example.com/' }));
//! <a href="https://example.com/">Link</a>

console.log(myTemplate({ x: 'javascript:evil()' }));
//! <a href="about:invalid#TrustedURL">Link</a>
```

See [*pug-require*](https://www.npmjs.com/package/pug-require) for
more details.

### Inline Templates                    <a name="hdr-inline-templates"></a>

First you need a dependency:

```sh
npm install --save pug-template-tag
```

Then you can declare Pug templates inline in JS or TS code.

```js
const pug = require('pug-template-tag');

const myTemplate = pug`a(href=x) Link`;

console.log(myTemplate({ x: 'https://example.com/' }));
//! <a href="https://example.com/">Link</a>

console.log(myTemplate({ x: 'javascript:evil()' }));
//! <a href="about:invalid#TrustedURL">Link</a>
```

See [*pug-template-tag*](https://www.npmjs.com/package/pug-template-tag) for
more details including how to configure templates.


### Pre-compiled or manually compiled Templates   <a name="hdr-pre-compiled-or-manually-compiled-templates"></a>

First you need to install Pug and the Trusted Types Plugin.

```sh
npm install --save pug pug-plugin-trusted-types
```

Then add the plugin to the `plugins` field of your Pug options object.

#### Before                             <a name="hdr-before"></a>

```js
const pug = require('pug');

const myTemplate = pug.compile(
    templateCode,
    {
      // Options
    });
```

#### After                              <a name="hdr-after"></a>

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

*postCodeGen* stage plugins could undo security guarantees even if the
trusted types plugin runs late.

## Double checking expressions          <a name="hdr-double-checking-expressions"></a>

Expressions in Pug templates, whether for attribute values or for text nodes, are
double-checked as described below.

| Pug Example        | Value of X                      | Policy                         |
| ------------------ | ------------------------------- | ------------------------------ |
| `div(title=x)`     | **Ordinary attribute value**    |                                |
|                    | Any value                       | No change                      |
| `a(href=x)`        | **External URL attribute**      | [TrustedURL.sanitize][]        |
|                    | Constant expression             | No change                      |
|                    | `http:` ...                     | No change                      |
|                    | `https:` ...                    | No change                      |
|                    | `mailto:` ...                   | No change                      |
|                    | [TrustedURL][]                  | No change                      |
|                    | [TrustedResourceURL][]          | No change                      |
|                    | Other                           | Replaced with `about:invalid`  |
| `script(src=x)`    | **URL loaded into same origin** |                                |
|                    | Constant expression             | No change                      |
|                    | [TrustedResourceURL][]          | No change                      |
|                    | Other                           | Replaced with `about:invalid`  |
| `p =x`             | **Text in a normal element**    |                                |
|                    | Constant expression             | Auto-escaped unless `!=`       |
|                    | [TrustedHTML][]                 | No change                      |
|                    | Other                           | Auto-escaped                   |
| `script =x`        | **Text in `<script>` element**  |                                |
|                    | Constant expression             | No change                      |
|                    | [TrustedScript][]               | No change                      |
|                    | Other                           | Replaced with space            |
| `iframe(srcdoc=x)` | **HTML in attribute**           |                                |
|                    | Constant expression             | No change                      |
|                    | [TrustedHTML][]                 | Escaped once to embed as value |
|                    | Other                           | Escaped twice to embed in HTML |

It doesn't matter whether an attribute value appears via assignment as
in `element(attribute=expression)` or in an [attribute block][] like
`element()&attributes({ attribute: expression })`.

[pug-compile-code-snippet]: https://github.com/pugjs/pug/blob/a1b046321416fc4ab297b43083ccda25ec8959e5/packages/pug/lib/index.js#L260-L262
[attribute block]: https://pugjs.org/language/attributes.html#attributes
[TrustedHTML]: https://www.npmjs.com/package/web-contract-types#hdr-class-trustedhtml
[TrustedResourceURL]: https://www.npmjs.com/package/web-contract-types#hdr-class-trustedresourceurl
[TrustedScript]: https://www.npmjs.com/package/web-contract-types#hdr-class-trustedscript
[TrustedURL]: https://www.npmjs.com/package/web-contract-types#hdr-class-trustedurl
[TrustedURL.sanitize]: https://www.npmjs.com/package/web-contract-types#hdr-trustedurl-sanitize
