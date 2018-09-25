'use strict';

/**
 * @fileoverview
 * Some sanity checks for README.md files.
 *
 * - Checks example code in README.md files for well-formedness
 * - Runs example code that has a comment like //! expected output
 * - Looks for undefined link targets like [foo][never defines].
 * - Checks that tables of contents are up-to-date with the pages header structure.
 */

/* eslint no-sync: 0 */

const { expect } = require('chai');
const { describe, it } = require('mocha');

// eslint-disable-next-line id-length
const fs = require('fs');
const path = require('path');
// eslint-disable-next-line id-length
const vm = require('vm');

const markdownPaths = {};

const packagesDir = path.join(path.dirname(__dirname), 'packages');
for (const child of fs.readdirSync(packagesDir)) {
  const markdownPath = path.join(packagesDir, child, 'README.md');
  if (fs.existsSync(markdownPath)) {
    markdownPaths[child] = markdownPath;
  }
}

const {
  tableOfContentsFor,
  replaceTableOfContentsIn,
} = require('../scripts/markdown-table-of-contents.js');


function lookForUndefinedLinks(markdownPath) {
  let markdown = fs.readFileSync(markdownPath, { encoding: 'utf8' });

  // Strip out code blocks.
  markdown = markdown.replace(
    /^(\s*)```js\n(?:[^`]|`(?!``))*\n\1```\n/mg, '$1CODE\n');

  // Extract link names.
  const namedLinks = new Set();
  for (;;) {
    const original = markdown;
    markdown = markdown.replace(/^\[(.*?)\]:[ \t]*\S.*/m, (all, name) => {
      namedLinks.add(name);
      return `<!-- ${ all } -->`;
    });
    if (original === markdown) {
      break;
    }
  }

  let undefinedLinks = new Set();
  function extractLink(whole, text, target) {
    target = target || text;
    if (!namedLinks.has(target)) {
      undefinedLinks.add(target);
    }
    return ' LINK ';
  }
  // Look at links.
  for (;;) {
    const original = markdown;
    markdown = markdown.replace(
      /\[((?:[^\\\]]|\\.)+)\]\[(.*?)\]/,
      extractLink);
    if (original === markdown) {
      break;
    }
  }

  undefinedLinks = Array.from(undefinedLinks);
  expect(undefinedLinks).to.deep.equals([]);
}


function hackyUpdoc(markdownPath) {
  const markdown = fs.readFileSync(markdownPath, { encoding: 'utf8' });

  // Strip out code blocks.
  const fencedJsBlockPattern = /^(\s*)```js(\n(?:[^`]|`(?!``))*)\n\1```\n/mg;
  for (let match; (match = fencedJsBlockPattern.exec(markdown));) {
    const [ , , code ] = match;
    const lineOffset = markdown.substring(0, match.index).split(/\n/g).length;

    it(`Line ${ lineOffset }`, () => {
      let tweakedCode = code.replace(
        /^console[.]log\((.*)\);\n\/\/! ?(.*)/mg,
        (whole, expr, want) => `expect(String(${ expr })).to.equal(${ JSON.stringify(want) });\n`);

      if (tweakedCode === code) {
        // Not a test.  Just check well-formedness
        tweakedCode = `(function () {\n${ tweakedCode }\n})`;
      }

      const script = new vm.Script(tweakedCode, { filename: markdownPath, lineOffset });

      script.runInNewContext({ require, expect });
    });
  }
}


describe('doc', () => {
  describe('links', () => {
    for (const [ name, mdPath ] of Object.entries(markdownPaths)) {
      it(name, () => {
        lookForUndefinedLinks(mdPath);
      });
    }
  });
  describe('code examples', () => {
    for (const [ name, mdPath ] of Object.entries(markdownPaths)) {
      describe(name, () => {
        hackyUpdoc(mdPath);
      });
    }
  });
  describe('tocs', () => {
    for (const [ name, mdPath ] of Object.entries(markdownPaths)) {
      it(name, () => {
        const originalMarkdown = fs.readFileSync(mdPath, { encoding: 'utf8' });
        const { markdown, toc } = tableOfContentsFor(mdPath, originalMarkdown);
        const markdownProcessed = replaceTableOfContentsIn(mdPath, markdown, toc);
        expect(originalMarkdown).to.equal(markdownProcessed, mdPath);
      });
    }
  });
});
