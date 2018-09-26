'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');

const contracts = require('pug-contracts-trusted-types');

describe('contracts', () => {
  it('contentTypeForElement', () => {
    // 3 means SCRIPT
    // eslint-disable-next-line no-magic-numbers
    expect(contracts.contentTypeForElement('script')).to.equal(3);
  });
  it('typeOfAttribute', () => {
    expect(contracts.typeOfAttribute(
      'script', 'src',
      // Getter for value of other attributes where known.
      (x) => (x === 'type' ? 'javascript' : null)))
      // 4 means TRUSTED_RESOURCE_URL
      // eslint-disable-next-line no-magic-numbers
      .to.equal(4);
  });
  it('link rel=alternate', () => {
    expect(contracts.typeOfAttribute(
      'link', 'href',
      // Getter for value of other attributes where known.
      (x) => (x === 'rel' ? 'alternate' : null)))
      // 3 means TRUSTED_URL
      // eslint-disable-next-line no-magic-numbers
      .to.equal(3);
  });
  it('link rel=stylesheet', () => {
    expect(contracts.typeOfAttribute(
      'link', 'href',
      // Getter for value of other attributes where known.
      (x) => (x === 'rel' ? 'stylesheet' : null)))
      // 4 means TRUSTED_RESOURCE_URL
      // eslint-disable-next-line no-magic-numbers
      .to.equal(4);
  });
  it('link rel=?', () => {
    expect(contracts.typeOfAttribute(
      'link', 'href',
      // Getter for value of other attributes where known.
      () => null))
      // 4 means TRUSTED_RESOURCE_URL
      // eslint-disable-next-line no-magic-numbers
      .to.equal(4);
  });
});
