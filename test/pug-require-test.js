'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');

require('pug-require');

const { TrustedHTML } = require('web-contract-types');

describe('pug-require', () => {
  describe('link-variable-href', () => {
    // eslint-disable-next-line global-require
    const template = require('./cases/link-variable-href/input.pug');
    it('https', () => {
      const html = template({ x: 'https://example.com' });
      expect(TrustedHTML.is(html)).to.equal(true);
      expect(String(html)).to.equal('<a href="https://example.com">Link</a>');
    });
  });
});

// TODO: test uninstall, reinstall
