/* eslint no-sync: 0 */
// Synchronous test code is less error-prone.

// Walks the cases directory to find test cases.
// Each child directory should have
// - input.pug
// - want.json
// The former is compiled, with the plugin.
// The AST after the plugin is applied is normalized then compared to the contents of want.json.

'use strict';

require('module-keys/cjs').polyfill(module, require, __filename);

const fs = require('fs'); // eslint-disable-line id-length
const path = require('path');

const { expect } = require('chai');
const { describe, it } = require('mocha');

const pug = require('pug');
const ttPlugin = require('pug-plugin-trusted-types');

const { makeModuleKeys } = require('module-keys');
const { Mintable } = require('node-sec-patterns');
const {
  TrustedHTML,
  TrustedResourceURL,
  TrustedScript,
  TrustedURL,
} = require('web-contract-types');

const mintTrustedHTML = require.keys.unboxStrict(Mintable.minterFor(TrustedHTML));
const mintTrustedResourceURL = require.keys.unboxStrict(Mintable.minterFor(TrustedResourceURL));
const mintTrustedScript = require.keys.unboxStrict(Mintable.minterFor(TrustedScript));
const mintTrustedURL = require.keys.unboxStrict(Mintable.minterFor(TrustedURL));


function requireStub(id) {
  // TODO: use a require extension handler to allow loading compiled code
  // in a context with ambient, hookable require.
  switch (id) {
    case 'pug-runtime-trusted-types':
    case 'pug-scrubber-trusted-types':
      // eslint-disable-next-line global-require
      return require(id);
    // TODO: scrubbers
    default:
      throw new Error(id);
  }
}
requireStub.keys = makeModuleKeys();


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
      // Strip debugging cruft.
      const obj = Object.assign(value);
      delete obj.line;
      delete obj.column;
      delete obj.filename;
      if (obj.type === 'Code' && obj.buffer && obj.val === '\'\\n\'') {
        // Skip line-breaks inserted to make HTML output easier to diff.
        return void 0;
      }
      return obj;
    }
    return value;
  });

  let json = JSON.stringify(ast, null, 2);
  // We use unpredictable identifiers which are stable, but
  // need not be overmatched in test goldens.
  // Pull out the first such and globally replace it with
  // a simpler string.
  const hexes = /var (?:rt|sc)_([0-9a-f]{64}) =/.exec(json);
  if (hexes) {
    json = json.replace(
      new RegExp(String.raw`\b(rt_|sc_)${ hexes[1] }\b`, 'g'),
      `$1${ 'x'.repeat(hexes[1].length) }`);
  }

  return json;
}


function trimBlankLinesAtEnd(str) {
  return str.replace(/[\r\n]*$/, '\n');
}


function stripLineContinuations(str) {
  return str.replace(
    /(\\+)\n/g,
    // eslint-disable-next-line no-bitwise
    (whole, slashes) => (slashes.length & 1 ? slashes.substring(1) : whole));
}


function reviveTrustedTypesForTest(key, val) {
  // Do not use in production code.
  if (val && typeof val === 'object' && !Array.isArray(val) &&
      typeof val.content === 'string' && typeof val.minter === 'string') {
    switch (val.minter) {
      case 'TrustedHTML': return mintTrustedHTML(val.content);
      case 'TrustedResourceURL': return mintTrustedResourceURL(val.content);
      case 'TrustedScript': return mintTrustedScript(val.content);
      case 'TrustedURL': return mintTrustedURL(val.content);
      default: break;
    }
  }
  return val;
}


let caseCount = 0;
const unusedTestFiles = [];

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

            let pugSource = fs.readFileSync(inputFile, 'utf-8');
            let optionsFromSource = {};
            pugSource = pugSource.replace(
              /^- \/\/!options[ \t]+([^\n]+)/,
              (whole, options) => {
                optionsFromSource = JSON.parse(options);
                return '';
              });

            const fun = pug.compile(
              pugSource,
              {
                filename: inputFile,
                plugins: [ ttPlugin, interceptAst ],
                basedir: __dirname,
                filterOptions: {
                  trustedTypes: {
                    report(msg) {
                      consoleOutput += `${ msg }\n`;
                    },
                    ...optionsFromSource,
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
            const locals = JSON.parse(
              fs.readFileSync(endToEndTest, 'UTF-8'),
              reviveTrustedTypesForTest);
            const { fun } = getCompiled();
            let html = null;
            try {
              // TODO: figure out how to inject this reliably.
              global.require = requireStub;
              html = fun(locals);
            } finally {
              global.require = null;
            }

            if (TrustedHTML.is(html)) {
              html = `<!-- TrustedHTML -->\n${ html.content }\n<!-- /TrustedHTML -->`;
            }

            const goldenHtml = endToEndTest.replace(/[.]json$/, '.out.html');
            compareFileTo(
              goldenHtml, String(html),
              (txt) => trimBlankLinesAtEnd(stripLineContinuations(txt)));
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
