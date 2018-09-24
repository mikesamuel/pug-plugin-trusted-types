'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');

const {
  configurePug,
  reinstall,
  uninstall,
} = require('pug-require');
const ttPlugin = require('pug-plugin-trusted-types');

const { TrustedHTML } = require('web-contract-types');

reinstall();
configurePug({
  plugins: [ ttPlugin ],
});
try {
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
} finally {
  uninstall();
}
