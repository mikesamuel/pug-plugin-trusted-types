'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');

const { TrustedURL } = require('web-contract-types');

const { scrubAttrs } = require('pug-scrubber-trusted-types');


describe('scrubber', () => {
  describe('scrubAttrs', () => {
    it('polymorphic conditional attribute', () => {
      let invocationCount = 0;
      const inputBundle = {
        rel: {
          i: 0,
          toString() {
            ++invocationCount;
            return this.i++ ? 'stylesheet' : 'alternate';
          },
        },
        href: 'http://foo.com/styles.css',
      };
      const outputBundle = scrubAttrs('link', inputBundle);

      expect(Object.getOwnPropertyNames(outputBundle))
        .to.deep.equals([ 'rel', 'href' ]);

      const { href, rel } = outputBundle;
      expect(rel).to.equal('alternate');
      expect(TrustedURL.is(href)).to.equal(true);
      expect(href.content).to.equal('http://foo.com/styles.css');

      expect(invocationCount).to.equal(1);
    });
    it('mixed-case-names', () => {
      const outputBundle = scrubAttrs(
        'link',
        {
          HREF: 'http://bar.com/Index.html',
          Rel: 'alternate',
        });

      expect(Object.getOwnPropertyNames(outputBundle))
        .to.deep.equals([ 'href', 'rel' ]);

      const { href, rel } = outputBundle;
      expect(rel).to.equal('alternate');
      expect(TrustedURL.is(href)).to.equal(true);
      expect(href.content).to.equal('http://bar.com/Index.html');
    });
    describe('prototyping is a pita', () => {
      it('__proto__', () => {
        const outputBundle = scrubAttrs(
          'link',
          {
            __Proto__: {
              rel: 'alternate',
            },
            HREF: 'http://bar.com/Index.html',
          });

        expect(Object.getOwnPropertyNames(outputBundle))
          .to.deep.equals([ 'href' ]);

        const { href, rel } = outputBundle;
        expect(rel).to.equal(void 0);
        expect(TrustedURL.is(href)).to.equal(true);
        expect(href.content).to.equal('about:invalid#TrustedResourceURL');
      });
      it('prototype', () => {
        const outputBundle = scrubAttrs(
          'link',
          Object.assign(
            Object.create({ rel: 'alternate' }),
            {
              Href: 'http://bar.com/Index.html',
            }));

        expect(Object.getOwnPropertyNames(outputBundle))
          .to.deep.equals([ 'href' ]);

        const { href, rel } = outputBundle;
        expect(rel).to.equal(void 0);
        expect(TrustedURL.is(href)).to.equal(true);
        expect(href.content).to.equal('about:invalid#TrustedResourceURL');
      });
    });
    it('symbols are not attribute names', () => {
      const outputBundle = scrubAttrs(
        'div',
        {
          [Symbol('click')]: 'alert(1)',
          class: 'foo bar',
        });

      expect(outputBundle)
        .to.deep.equals({
          class: 'foo bar',
        });
    });
  });
});
