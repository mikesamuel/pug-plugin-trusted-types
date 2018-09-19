/* eslint no-sync: 0 */
// Synchronous test code is less error-prone.

// Walks the cases directory to find test cases.
// Each child directory should have
// - input.pug
// - want.json
// The former is compiled, with the plugin.
// The AST after the plugin is applied is normalized then compared to the contents of want.json.

'use strict';

const fs = require('fs'); // eslint-disable-line id-length
const path = require('path');

const { expect } = require('chai');
const { describe, it } = require('mocha');

const pug = require('pug');
const thisPlugin = require('../plugin.js');

let caseCount = 0;

function compareFileTo(file, want, normalize) {
  let got = fs.readFileSync(file);
  if (normalize) {
    got = normalize(got);
    want = normalize(want);
  }
  expect(got).to.equal(want, file);
}


function normalizeAst(pugAstString) {
  const ast = JSON.parse(pugAstString, (key, value) => {
    if (Array.isArray(value)) {
      return value.filter((x) => x !== void 0);
    }
    if (value && typeof value === 'object') {
      // Strip comments.
      if (value.type === 'Comment') {
        return void 0;
      }
      // Strip debugging cruft.
      const obj = Object.assign(value);
      delete obj.line;
      delete obj.column;
      delete obj.filename;
    }
    return value;
  });
  return JSON.stringify(ast, null, 2);
}

describe('case', () => {
  const casesDir = path.join(__dirname, 'cases');
  for (const child of fs.readdirSync(casesDir)) {
    const caseDir = path.join(casesDir, child);
    const inputFile = path.join(caseDir, 'input.pug');
    if (fs.existsSync(inputFile)) {
      ++caseCount;
      it(child, () => {
        let got = null;
        const interceptAst = {
          preCodeGen(ast) {
            expect(got).to.equal(null, caseDir);
            expect(typeof ast).to.equal('object', caseDir);
            expect(ast).to.not.equal(null, caseDir);
            got = ast;
            return ast;
          },
        };

        pug.compile(
          fs.readFileSync(inputFile, 'utf-8'),
          {
            filename: path.join('cases', child, 'input.pug'),
            plugins: [ thisPlugin, interceptAst ],
          });

        expect(got).to.not.equal(null, caseDir);

        const goldenJson = path.join(caseDir, 'expected-ast.json');
        compareFileTo(goldenJson, JSON.stringify(got), normalizeAst);
      });
    }
  }
});

describe('cases', () => {
  it('has cases', () => {
    expect(caseCount > 0).to.equal(true, caseCount);
  });
});
