'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');

const pug = require('pug-template-tag');

const { TrustedHTML } = require('web-contract-types');

const ttPlugin = require('pug-plugin-trusted-types');

const addDoctypePlugin = {
  postLoad(ast) {
    ast.nodes.splice(
      0, 0,
      {
        'type': 'Doctype',
        'val': 'html',
      });
    return ast;
  },
  toString() {
    return '(pug-plugin-add-doctype)';
  },
};

describe('pug-template-tag', () => {
  it('default-options', () => {
    const templateFunction = pug`
      doctype html
      a(href=url) Link`;

    const html = templateFunction({ url: 'https://example.com' });
    expect(TrustedHTML.is(html)).to.equal(true);
    expect(String(html)).to.equal('<!DOCTYPE html><a href="https://example.com">Link</a>');
  });
  it('configured with plugins', () => {
    const templateFunction = pug({ plugins: [ addDoctypePlugin ] })`a(href=url) Link`;
    const html = templateFunction({ url: 'https://example.com' });
    expect(TrustedHTML.is(html)).to.equal(true);
    expect(String(html)).to.equal('<!DOCTYPE html><a href="https://example.com">Link</a>');
  });
  it('configured with plugins including ttPlugin', () => {
    const templateFunction = pug({ plugins: [ ttPlugin, addDoctypePlugin ] })`a(href=url) Link`;
    const html = templateFunction({ url: 'https://example.com' });
    expect(TrustedHTML.is(html)).to.equal(true);
    expect(String(html)).to.equal('<!DOCTYPE html><a href="https://example.com">Link</a>');
  });
  it('stack trace lines', () => {
    const templateFunction = pug`
      doctype html
      a(href=((null)[x])) Throws Up`;
    expect(() => templateFunction({ x: 'x' })).to.throw(
      Error, 'Cannot read property \'x\' of null on line 52');
  });
  describe('interpolations', () => {
    it('long', () => {
      expect(
        () =>
          pug`
          doctype html
          html
            head
              title =${ '' }
            body
              p
                Hello, World!`)
        .to.throw(
          Error,
          [
            // eslint-disable-next-line array-element-newline
            'Interpolating pug code into a template is an XSS risk: ',
            '...   title =$', '{x}\n         ...',
          ].join(''));
    });
    it('short', () => {
      expect(() => pug`p =(${ '' })`)
        .to.throw(
          Error,
          [
            // eslint-disable-next-line array-element-newline
            'Interpolating pug code into a template is an XSS risk: p =($',
            '{x})',
          ].join(''));
    });
  });
  it('__proto__', () => {
    // See pug-require-test for explanation.
    let intercepted = false;
    const options = JSON.parse(
      '{ "__proto__": {} }',
      (key, value) => (
        (key === '__proto__') ?
          {
            set plugins(x) {
              intercepted = true;
            },
            get plugins() {
              return [];
            },
          } :
          value));

    expect(() => pug(options)`p Hello, World!`).to.throw(Error);
    expect(intercepted).to.equal(false);
  });
  it('null options', () => {
    const templateFunction = pug(null)`a(href=x) Link`;
    const html = templateFunction({ x: 'https://example.com/null-options' });
    expect(TrustedHTML.is(html)).to.equal(true);
    expect(String(html)).to.equal('<a href="https://example.com/null-options">Link</a>');
  });
});
