'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');

const pug = require('pug-template-tag');

const { TrustedHTML } = require('web-contract-types');

describe('pug-template-tag', () => {
  it('default-options', () => {
    const templateFunction = pug`
      doctype html
      a(href=url) Link`;

    const html = templateFunction({ url: 'https://example.com' });
    expect(TrustedHTML.is(html)).to.equal(true);
    expect(String(html)).to.equal('<!DOCTYPE html><a href="https://example.com">Link</a>');
  });
  it('stack trace lines', () => {
    const templateFunction = pug`
      doctype html
      a(href=((null)[x])) Throws Up`;
    expect(() => templateFunction({ x: 'x' })).to.throw(
      Error, 'Cannot read property \'x\' of null on line 23');
  });
});
