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
const unusedTestFiles = [];

function compareFileTo(file, want, normalize, defaultText = null) {
  let got = defaultText;
  try {
    got = fs.readFileSync(file, 'UTF-8');
  } catch (exc) {
    if (defaultText === null) {
      throw exc;
    }
  }
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

function trimBlankLinesAtEnd(str) {
  return str.replace(/[\r\n]*$/, '\n');
}

describe('case', () => {
  const casesDir = path.join(__dirname, 'cases');
  for (const caseName of fs.readdirSync(casesDir)) {
    const caseDir = path.join(casesDir, caseName);
    const inputFile = path.join(caseDir, 'input.pug');
    if (fs.existsSync(inputFile)) {
      ++caseCount;

      const endToEndTests = [];
      const outputHtmlFiles = [];
      for (const caseFile of fs.readdirSync(caseDir)) {
        const testFilePath = path.join(caseDir, caseFile);
        if (/[.]pug$|^expected-ast[.]json$|^stderr[.]txt$/.test(caseFile)) {
          // handled separately
        } else if (/[.]json$/.test(caseFile)) {
          endToEndTests.push(testFilePath);
        } else if (/[.]out[.]html$/.test(caseFile)) {
          outputHtmlFiles.push(testFilePath);
        } else {
          unusedTestFiles.push(testFilePath);
        }
      }
      const expectedHtmlFiles = new Set(endToEndTests.map((x) => x.replace(/[.]json$/, '.out.html')));
      unusedTestFiles.push(...outputHtmlFiles.filter((x) => !expectedHtmlFiles.has(x)));

      describe(caseName, () => {
        let compiled = null;
        let consoleOutput = '';
        function getCompiled() {
          if (!compiled) {
            let astPreCodeGen = null;
            const interceptAst = {
              preCodeGen(ast) {
                expect(astPreCodeGen).to.equal(null, caseDir);
                expect(typeof ast).to.equal('object', caseDir);
                expect(ast).to.not.equal(null, caseDir);
                astPreCodeGen = ast;
                return ast;
              },
            };

            const fun = pug.compile(
              fs.readFileSync(inputFile, 'utf-8'),
              {
                filename: path.join('cases', caseName, 'input.pug'),
                plugins: [ thisPlugin, interceptAst ],
                filterOptions: {
                  trustedTypes: {
                    report(msg) {
                      consoleOutput += `${ msg }\n`;
                    },
                  },
                },
              });

            compiled = { ast: astPreCodeGen, fun };
          }
          return compiled;
        }

        it('AST', () => {
          const { ast } = getCompiled();

          expect(ast).to.not.equal(null, caseDir);

          const goldenJson = path.join(caseDir, 'expected-ast.json');
          compareFileTo(goldenJson, JSON.stringify(ast), normalizeAst);
        });

        it('log', () => {
          compareFileTo(
            path.join(caseDir, 'stderr.txt'),
            consoleOutput, trimBlankLinesAtEnd, '');
        });

        for (const endToEndTest of endToEndTests) {
          it(endToEndTest.replace(/^.*[\\/]|[.]json$/g, ''), () => {
            const locals = JSON.parse(fs.readFileSync(endToEndTest, 'UTF-8'));
            const { fun } = getCompiled();
            let html = null;
            try {
              // TODO: figure out how to inject this reliably.
              // eslint-disable-next-line camelcase
              global.pug_uncheckedConversionToTrustedHtml =
                (output) => `<!-- TrustedHTML -->\n${ output }\n<!-- /TrustedHTML -->`;
              html = fun(locals);
            } finally {
              // eslint-disable-next-line camelcase
              global.pug_uncheckedConversionToTrustedHtml = null;
            }
            const goldenHtml = endToEndTest.replace(/[.]json$/, '.out.html');
            compareFileTo(goldenHtml, html, trimBlankLinesAtEnd);
          });
        }
      });
    }
  }
});

describe('cases', () => {
  it('has cases', () => {
    expect(caseCount > 0).to.equal(true, caseCount);
  });
  it('unused test files', () => {
    expect(unusedTestFiles).to.deep.equal([]);
  });
});
