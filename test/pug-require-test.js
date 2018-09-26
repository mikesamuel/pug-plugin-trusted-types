'use strict';

/* eslint global-require: 0 */

const { expect } = require('chai');
const { describe, it } = require('mocha');

const { configurePug, reinstall, uninstall } = require('pug-require');

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

describe('pug-require', () => {
  describe('link-variable-href', () => {
    // eslint-disable-next-line global-require
    const template = require('./cases/link-variable-href/input.pug');
    it('https', () => {
      const html = template({ x: 'https://example.com' });
      expect(TrustedHTML.is(html)).to.equal(true);
      expect(String(html)).to.equal('<a href="https://example.com">Link</a>');
    });
    it('javascript', () => {
      // eslint-disable-next-line no-script-url
      const html = template({ x: 'javascript://example.com#\nalert(1)' });
      expect(TrustedHTML.is(html)).to.equal(true);
      expect(String(html)).to.equal('<a href="about:invalid#TrustedURL">Link</a>');
    });
  });
  it('uninstall', () => {
    uninstall();
    try {
      uninstall();
      expect(() => require('./templates/a.pug')).to.throw(Error, 'Unexpected identifier');
    } finally {
      reinstall();
    }
  });
  it('reinstall', () => {
    reinstall();
    reinstall();
    const template = require('./templates/b.pug');
    const html = template({ x: 'https://example.com/reinstall' });
    expect(TrustedHTML.is(html)).to.equal(true);
    expect(String(html)).to.equal('<a href="https://example.com/reinstall">Link</a>');
  });
  it('configure', () => {
    configurePug({
      plugins: [ addDoctypePlugin ],
    });
    try {
      const template = require('./templates/c.pug');
      const html = template({ x: 'https://example.com/configure' });
      expect(TrustedHTML.is(html)).to.equal(true);
      expect(String(html)).to.equal('<!DOCTYPE html><a href="https://example.com/configure">Link</a>');
    } finally {
      configurePug({});
    }
    const template = require('./templates/d.pug');
    const html = template({ x: 'https://example.com/configure' });
    expect(TrustedHTML.is(html)).to.equal(true);
    expect(String(html)).to.equal('<a href="https://example.com/configure">Link</a>');
  });
  it('ttPlugin', () => {
    configurePug({
      plugins: [ ttPlugin ],
    });
    try {
      const template = require('./templates/e.pug');
      const html = template({ x: 'https://example.com/ttPlugin' });
      expect(TrustedHTML.is(html)).to.equal(true);
      expect(String(html)).to.equal('<a href="https://example.com/ttPlugin">Link</a>');
    } finally {
      configurePug({});
    }
  });
  it('__proto__', () => {
    let intercepted = false;
    const options = JSON.parse(
      // This gives us an object with an actual __proto__
      // field.
      '{ "__proto__": {} }',
      (key, value) => (
        // Substitute an intercepter for the value of the
        // __proto__ field.
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
    expect(Object.hasOwnProperty.call(options, '__proto__')).to.equal(true);

    try {
      expect(() => configurePug(options))
        .to.throw(Error, '__proto__ interacts badly with Object.assign');

      const template = require('./templates/f.pug');
      const html = template({ x: 'https://example.com/__proto__' });
      expect(TrustedHTML.is(html)).to.equal(true);
      expect(String(html)).to.equal('<a href="https://example.com/__proto__">Link</a>');

      expect(intercepted).to.equal(false);
    } finally {
      configurePug(Object.create(null));
    }
  });
  it('null options', () => {
    configurePug(null);
    const template = require('./templates/g.pug');
    const html = template({ x: 'https://example.com/null-options' });
    expect(TrustedHTML.is(html)).to.equal(true);
    expect(String(html)).to.equal('<a href="https://example.com/null-options">Link</a>');
  });
});

// TODO: test configure uninstall, reinstall
