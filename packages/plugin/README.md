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
   *  [Webpack integration via pug-loader](#hdr-webpack-integration-via-pug-loader)
   *  [Requiring Templates](#hdr-requiring-templates)
   *  [Inline Templates](#hdr-inline-templates)
   *  [Pre-compiled or manually compiled Templates](#hdr-pre-compiled-or-manually-compiled-templates)
      *  [Before](#hdr-before)
      *  [After](#hdr-after)
*  [Double checking expressions](#hdr-double-checking-expressions)
*  [Automagic](#hdr-automagic)
   *  [CSRF (Cross-Site Request Forgery) Protection](#hdr-csrf-cross-site-request-forgery-protection)
      *  [Configuring with csrf-crypto](#hdr-configuring-with-csrf-crypto)
   *  [Content-Security-Policy](#hdr-content-security-policy)
*  [Plugin Configuration](#hdr-plugin-configuration)
   *  [csrfInputName](#hdr-csrfinputname)
   *  [csrfInputValueExpression](#hdr-csrfinputvalueexpression)
   *  [nonceValueExpression](#hdr-noncevalueexpression)
   *  [report(message)](#hdr-report-message-)

<!-- /TOC -->

This plugin focuses on checking URLs, to prevent, e.g. arbitrary strings from reaching `<script src>` or
`javascript:` URLs from reaching `<a href>`.

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

This plugin cannot, by itself, prevent XSS due to intentionally
[unsafe][] features but when it finds a use of unsafe features, it
warns on them and refuses to output [TrustedHTML][].

## Usage                                <a name="hdr-usage"></a>

There are several ways to use safe Pug templates.

The Trusted Types plugin adds `require` calls which only work with
code loaded in a CommonJS module context.

Pug compiles templates to JavaScript which it loads by
[calling `new Function()`][pug-compile-code-snippet] so does not
load in a module context.

### Webpack integration via pug-loader   <a name="hdr-webpack-integration-via-pug-loader"></a>

[Pug-loader][] makes it easy to compile templates when webpacking.

You do need to configure pug-loader to use this plugin though.

If you're using `pug-loader`, your webpack.config.js should probably have something like:

```js
({
  rules: [
    // When loading Pug, run pug-loader.
    {
      test: /\.pug$/,
      use: [
        {
          loader: path.resolve('node_modules/pug-loader/index.js'),
          options: {
            plugins: [
              // Any other plugins you use should ideally go first.
              require('pug-plugin-trusted-types'),
            ],
          },
          // Optionally, configure the plugin.  You probably won't need to do this.
          filterOptions: {
            trustedTypes: {
              // See "Plugin Configuration" below.
            },
          },
        },
      ],
    },
    // This runs the module-keys babel processor on all JavaScript sources.
    {
      test: /\.js$/,
      use: [
        {
          loader: path.resolve('node_modules/babel-loader/lib/index.js'),
          options: {
            plugins: ['module-keys/babel'],
          },
        },
      ],
      exclude: /node_modules\/(webpack\/buildin|module-keys|path-browserify|process)/,
    },
  ],
})
```


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

## Automagic                            <a name="hdr-automagic"></a>

### CSRF (Cross-Site Request Forgery) Protection   <a name="hdr-csrf-cross-site-request-forgery-protection"></a>

CSRF Protection works by putting enough information in `<form>`s so
that the server can double check that it served the form.

[Configure](#hdr-plugin-configuration) the plugin with options like

```json
{
  "csrfInputName":            "csrf",
  "csrfInputValueExpression": "csrfTokenValue"
}
```

When rendering HTML, pass a value to the template for the CSRF input value expression:

```js
let templateInput = {
  "csrfTokenValue": "r4Nd0M_NuM83R"
};
```

Any form in your PUG template like:

```pug
form(action='delete' method='POST')
  button(type='submit') Delete
```

will have a hidden input added:

```html
<form action="delete" method="POST">
  <input name="csrf" type="hidden" value="r4Nd0M_NuM83R"/>
  <button type="submit">Delete</button>
</form>
```

#### Configuring with csrf-crypto       <a name="hdr-configuring-with-csrf-crypto"></a>

If you use [*csrf-crypto*](https://npmjs.com/package/csrf-crypto)
and you're plugging in via *pug-require*, then the pieces fit together like:

```js
// Configure pug-require to thread
const pugRequire = require('pug-require');
pugRequire.configurePug({
  filterOptions: {
    trustedTypes: {
      csrfInputName: '_csrf',
      // You could use 'res.getFormToken()' as the value expression
      // if you pass res to Pug.
      csrfInputValueExpression: 'csrfToken',
    },
  },
});

// Load a pug template after configuring pug-require
const template = require('./path/to/template.pug');

// Setup csrf-crypto to define res.getFormToken().
const csrfCrypt = require('csrf-crypto');
app.use(csrfCrypto({ key: applicationLevelSecret, /* ... */ }));
app.use(csrfCrypto.enforcer());

// When rendering HTML output using pug, provide access to the form token.
function handle(req, res) {
  // ...
  res.end(
    template({
      get csrfToken() {
        // Lazily generate a form token.
        delete this.csrfToken;
        this.csrfToken = res.getFormToken();
        return this.csrfToken;
      },
    }));
}
```

### Content-Security-Policy             <a name="hdr-content-security-policy"></a>

[Strict CSP](https://csp.withgoogle.com/docs/strict-csp.html) explains
how to use the *Content-Security-Policy* header to protect against
XSS:

> To enable a strict CSP policy, most applications will need to make the following changes:
>
> *  Add a nonce attribute to all `<script>` elements. **Some template systems can do this automatically.**
> *  Refactor any markup with inline event handlers (onclick, etc.) and javascript: URIs (details).
> *  For every page load, generate a new nonce, pass it the to the template system, and use the same value in the policy.

To automatically add `nonce` attributes,
[configure](#hdr-plugin-configuration) the plugin with options like

```json
{
  "nonceValueExpression": "sessionScopedRandomString"
}
```

And then generate a [strong][] *nonce* for each HTTP response, and pass it to your template:

```js
let templateInput = {
  // https://csp.withgoogle.com/docs/faq.html#generating-nonces says > 128b = 16B
  sessionScopedRandomString: require('uid-safe').sync(18),
};
```

**Caveat**: Do not use *npmjs.com/package/nonce*.  It does not provide
strong nonces, nor does it claim to.

Pug that loads CSS or JavaScript will have nonces automatically added.

```pug
head
  link(rel='stylesheet' src='/styles.css')
  script(src='/script.js')
  script main()
```

The output HTML will look like:

```html
<head>
  <link rel="stylesheet" src="/styles.css" nonce="7QgTXZjEaat5wrC8JAn0FsBq"/>
  <script src="/script.js" nonce="7QgTXZjEaat5wrC8JAn0FsBq"></script>
  <script nonce="7QgTXZjEaat5wrC8JAn0FsBq">main()</script>
</head>
```

If your HTTP response has a header like the below then those CSS and
JavaScript will load, but ones lacking the `nonce` attribute will not.

```
Content-Security-Policy: default-src 'nonce-7QgTXZjEaat5wrC8JAn0FsBq'
```


## Plugin Configuration                 <a name="hdr-plugin-configuration"></a>

Pug doesn't provide a way to directly configure plugins, but this plugin takes into account

```js
({
  filtersOptions: {
    trustedTypes: {
      report() {
        // ...
      }
    }
  }
})
```

### csrfInputName                       <a name="hdr-csrfinputname"></a>

A value for an `<input name>` attribute that is automatically added to
`<form>` elements to protect against Cross-Site Request Forgery
(CSRF).

Defaults to `csrfToken`.

See also [CSRF (Cross-Site Request Forgery) Protection](#hdr-csrf-cross-site-request-forgery-protection).

### csrfInputValueExpression            <a name="hdr-csrfinputvalueexpression"></a>

A string containing a JavaScript expression for the value
corresponding to the `csrfInputName`.

Defaults to `null`.  If `null`, then `<form>`s have no hidden input added.

See also [CSRF (Cross-Site Request Forgery) Protection](#hdr-csrf-cross-site-request-forgery-protection).

### nonceValueExpression                <a name="hdr-noncevalueexpression"></a>

A string containing a JavaScript expression for the value of `nonce`
attribute automatically added to `<script>` and `<style>` elements.

Defaults to `null`.  If `null`, then `nonce` attributes are not added.

See also [Content-Security-Policy](#hdr-content-security-policy).

### report(message)                     <a name="hdr-report-message-"></a>

Called if the plugin finds a problem with the template.

By default, this is `console.warn`.

[unsafe]: https://pugjs.org/language/code.html#unescaped-buffered-code
[pug-compile-code-snippet]: https://github.com/pugjs/pug/blob/a1b046321416fc4ab297b43083ccda25ec8959e5/packages/pug/lib/index.js#L260-L262
[attribute block]: https://pugjs.org/language/attributes.html#attributes
[TrustedHTML]: https://www.npmjs.com/package/web-contract-types#hdr-class-trustedhtml
[TrustedResourceURL]: https://www.npmjs.com/package/web-contract-types#hdr-class-trustedresourceurl
[TrustedScript]: https://www.npmjs.com/package/web-contract-types#hdr-class-trustedscript
[TrustedURL]: https://www.npmjs.com/package/web-contract-types#hdr-class-trustedurl
[TrustedURL.sanitize]: https://www.npmjs.com/package/web-contract-types#hdr-trustedurl-sanitize
[strong]: https://en.wikipedia.org/wiki/Cryptographically_secure_pseudorandom_number_generator
[Pug-loader]: https://npmjs.com/package/pug-loader
