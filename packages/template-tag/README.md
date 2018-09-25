# Pug Template Tag

[![npm](https://img.shields.io/npm/v/pug-template-tag.svg)](https://www.npmjs.com/package/pug-template-tag)

A template tag that allows defining [safe Pug][] templates inline in
JavaScript or TypeScript code.

<!-- TOC -->
*  [Installation](#hdr-installation)
*  [Usage](#hdr-usage)
*  [API](#hdr-api)
   *  [pug(pugOptions)](#hdr-pug-pugoptions-)
   *  [pug`...`](#hdr-pug-)
*  [Module System](#hdr-module-system)
*  [Plugins](#hdr-plugins)

<!-- /TOC -->

## Installation                         <a name="hdr-installation"></a>

```bash
$ npm install pug-template-tag
```

## Usage                                <a name="hdr-usage"></a>

```js
// Load the template tag.
const pug = require('pug-template-tag');

// Define a function using inline Pug code.
const templateFunction = pug({ /* pug options */ })`
  doctype html
  p
    =text
`;

// Apply a template to get HTML.
const html = templateFunction({ text: 'Hello, World!' });
```

Alternatively, you can configure the template tag once and reuse it.

```js
// Load the template tag.
const pugTemplateTag = require('pug-template-tag');

// Create a configured template tag.
const pug = pugTemplateTag({ /* pug options */ });


const templateFoo = pug`
  doctype html
  .foo= text`;

const templateBar = pug`
  doctype html
  .bar= text`;
```

## API                                  <a name="hdr-api"></a>

Package *pug-template-tag* exports a function that may either be called as
a [template tag][] to define a template or as a function that takes an
[options bundle][].

### pug(pugOptions)                     <a name="hdr-pug-pugoptions-"></a>

When called with a Pug [options bundle][], the exported function returns
an instance of the same function but which uses the given options bundle.

### pug`...`                            <a name="hdr-pug-"></a>

When called as a template tag:

1.  Reuses a previously compiled version if available.
2.  Strip common leading whitespace so you can indent Pug templates to
    match the indentation of surrounding code.
3.  Compiles the Pug source to a function.
4.  Creates a CommonJS module for the template code under the namespace
    `@pug-template`.
5.  Returns the template function.


# Escaping

The pug template tag behaves like `String.raw`.

<!--
TODO: implement this scheme.

in all situations except one.

Pug syntax allows for template strings.

[Multiline Attributes](https://pugjs.org/language/attributes.html#multiline-attributes)

> If your JavaScript runtime supports ES2015 template strings
> (including Node.js/io.js 1.0.0 and later), you can use that syntax
> for attributes. This is really useful for attributes with really
> long values:

> ```js
> input(data-json=`
>   {
>     "very-long": "piece of ",
>     "data": true
>   }
> `)
> ```

To embed these in a <code>pug\`...\`</code>, just escape the back-tick

> ```js
> const templateFunction = pug`
>   input(data-json=\`
>     {
>       "very-long": "piece of ",
>       "data": true
>     }
>   \`)
> `;
> ```

The pug template tag unescapes any back-tick that does not follow an
odd-length run of \\'s.  It will also unescape <code>\$</code> inside
backticks.  The pug template tag does not unescape any other
characters so `\n` will reach the Pug compiler unchanged.

-->

## Module System                        <a name="hdr-module-system"></a>

The pug template functions makes sure that error trace will point to
the source file.


## Plugins                              <a name="hdr-plugins"></a>

Regardless of options, the pug template function always attaches two plugins:

1.  A debug plugin that rewrites line numbers and files so that error messages
    point to the JavaScript code that defined the template.
2.  The [Trusted Types plugin][safe Pug]
    makes the template resistant to XSS since it is not a goal of this project
    to make it easier to produce unsafe templates.


[safe Pug]: https://npmjs.com/package/pug-plugin-trusted-types
[options bundle]: https://pugjs.org/api/reference.html#options
[template tag]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates
