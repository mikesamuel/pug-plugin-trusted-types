#!/usr/bin/env node

'use strict';

/**
 * @fileoverview
 * Gathers cross-package information so we can run one set of tests
 * and linters for all sub-packages.
 */

/* eslint no-console: 0, id-length: 0, no-sync: 0 */

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.dirname(__dirname);

function e(...parts) {
  // exists
  return fs.existsSync(path.join(...parts));
}

function rf(...parts) {
  // read file
  return fs.readFileSync(path.join(...parts), { encoding: 'utf8' });
}

function wf(outfile, content) {
  // write file
  return fs.writeFileSync(outfile, content, { encoding: 'utf8' });
}

function decompose(args) {
  // finds any optional options bundle at the beginning of the argument list
  return typeof args[0] === 'object' ? args : [ {}, ...args ];
}

function x(...args) {
  const [ opts, command, ...cmdArgs ] = decompose(args);
  const { trapStdout } = opts;

  // execute returning standard output as a string
  const { exc, status, signal, stdout } = childProcess.spawnSync(
    command, cmdArgs,
    Object.assign(
      {},
      {
        stdio: [ 'ignore', trapStdout ? 'pipe' : 'inherit', 'inherit' ],
        shell: false,
        encoding: 'utf8',
      },
      opts));
  if (exc || status || signal) {
    if (exc) {
      console.error(exc);
    }
    if (status || signal) {
      console.error(`${ command } exited with status ${ status }, signal ${ signal }`);
    }
    throw new Error(`${ command } failed`);
  }
  return trapStdout ? stdout.replace(/\n$/, '') : null;
}

function qx(...args) {
  const [ opts, command, ...cmdArgs ] = decompose(args);
  const xOpts = Object.assign({ trapStdout: true }, opts);
  return x(xOpts, command, ...cmdArgs);
}

function rmrf(...args) {
  const [ opts, ...parts ] = decompose(args);
  x(opts, 'rm', '-rf', path.join(...parts));
}

function mv(...args) {
  const [ opts, ...paths ] = decompose(args);
  x(opts, 'mv', ...paths);
}

function cp(...args) {
  const [ opts, ...paths ] = decompose(args);
  x(opts, 'cp', ...paths);
}


// TODO: reenable
// eslint-disable-next-line no-unused-vars
function fetchContracts() {
  // Keep contracts up-to-date with polymer-resin
  const polymerResinVersion = qx('npm', 'info', 'polymer-resin', 'version');

  const destDirName = path.join(root, 'packages', 'contracts');
  if (e(destDirName, '.polyresin') && rf(destDirName, '.polyresin') === polymerResinVersion) {
    return;
  }

  // Fetch contracts
  const tmpDirName = qx('mktemp', '-d');
  try {
    x({ cwd: tmpDirName }, 'npm', 'install', '--no-save', 'polymer-resin');
  } catch (exc) {
    // Ignore intermittent network failures.
    console.error(exc);
  }

  let contracts = rf(tmpDirName, 'node_modules', 'polymer-resin', 'lib', 'contracts', 'contracts.js');
  contracts = contracts.replace(
    /^goog[.](provide|module).*/m,
    'const security = { html: { contracts: {} } };');
  contracts += `

module.exports = {
  contentTypeForElement: security.html.contracts.contentTypeForElement,
  isEnumValueAllowed: security.html.contracts.isEnumValueAllowed,
  typeOfAttribute: security.html.contracts.typeOfAttribute,
}
`;
  wf(path.join(destDirName, 'index.js'), contracts);
  wf(path.join(destDirName, '.polyresin'), polymerResinVersion);

  rmrf(tmpDirName);
}

function computePackageOrder() {
  const packageDirs = fs.readdirSync(path.join(root, 'packages'), { encoding: 'utf8' })
    .map((name) => path.join(root, 'packages', name));
  const dirToName = Object.create(null);
  const nameToDir = Object.create(null);
  const metadata = Object.create(null);

  for (const packageDir of packageDirs) {
    const packageJson = path.join(packageDir, 'package.json');
    // eslint-disable-next-line global-require
    const packageMetadata = require(packageJson);
    const packageName = packageMetadata.name;
    dirToName[packageDir] = packageName;
    nameToDir[packageName] = packageDir;
    metadata[packageName] = packageMetadata;
  }

  const seen = new Set();
  const inOrder = [];

  function order(packageName) {
    if (seen.has(packageName) && packageName in metadata) {
      seen.add(packageName);
      for (const dep of Object.getOwnPropertyNames(metadata[packageName].dependencies)) {
        order(dep);
      }
    }
    inOrder.push(packageName);
  }

  for (const packageName in metadata) {
    order(packageName);
  }

  return inOrder.map((packageName) => ({
    name: packageName,
    dir: nameToDir[packageName],
    metadata: metadata[packageName],
  }));
}

function sortEntries(obj) {
  const sorted = Object.create(null);
  // eslint-disable-next-line
  const entries = Object.entries(obj).sort(([ a ], [ b ]) => (a < b ? -1 : a === b ? 0 : 1));
  for (const [ key, value ] of entries) {
    sorted[key] = value;
  }
  return sorted;
}

function updatePackageMetadata(packages, includeInternal) {
  // Updates <root>/package.json so that its dependencies are the union of the
  // dependencies of subpackages.
  const externalDependencies = Object.create(null);
  const internalDependencies = Object.create(null);
  const internalPackageNames = new Set(packages.map(({ name }) => name));
  for (const { metadata } of packages) {
    internalDependencies[metadata.name] = `^${ metadata.version }`;
  }
  for (const { metadata } of packages) {
    if (metadata.dependencies) {
      for (const [ dep, version ] of Object.entries(metadata.dependencies)) {
        const dependencies = internalPackageNames.has(dep) ?
          internalDependencies : externalDependencies;
        if (dep in dependencies) {
          if (version !== dependencies[dep]) {
            throw new Error(
              `Dependency conflict ${ JSON.stringify(dep) }: ${
                JSON.stringify(dependencies[dep]) } !== ${ JSON.stringify(version) }`);
          }
        } else {
          dependencies[dep] = version;
        }
      }
    }
  }

  // eslint-disable-next-line global-require
  const monorepometadata = require('../package.json');

  function updatePackageMetadataDependencies(dependencies) {
    const newDependencies = sortEntries(dependencies);
    monorepometadata.dependencies = newDependencies;
    wf(path.join(root, 'package.json'), `${ JSON.stringify(monorepometadata, null, 2) }\n`);
  }

  updatePackageMetadataDependencies(externalDependencies);
  x({ cwd: root }, 'npm', 'install');
  if (includeInternal) {
    updatePackageMetadataDependencies(
      Object.assign(externalDependencies, internalDependencies));
  }
}

function installLocally(packages) {
  // Save the package metadata files so that `npm install` of the packed tarballs does
  // not mess with them.
  cp(path.join(root, 'package.json'), path.join(root, 'package.json.saved'));
  cp(path.join(root, 'package-lock.json'), path.join(root, 'package-lock.json.saved'));

  // Pack and install packages in dependency order in the <root>/node_modules
  for (const { dir, name } of packages) {
    console.log(`PACKING ${ name }`);

    const tarball = path.join(dir, qx({ cwd: dir }, 'npm', 'pack'));
    console.log(`INSTALLING ${ name } from ${ tarball }`);
    rmrf(root, 'node_modules', name);
    x({ cwd: root }, 'mkdir', path.join('node_modules', name));
    x({ cwd: path.join(root, 'node_modules', name) }, 'tar', 'xzf', tarball, '--strip-components=1');
  }

  // Restore package metadata
  mv(path.join(root, 'package.json.saved'), path.join(root, 'package.json'));
  mv(path.join(root, 'package-lock.json.saved'), path.join(root, 'package-lock.json'));
}

function computeCoverageConfig(packages) {
  // Istanbul needs to instrument files under node_modules since that's where
  // the tests will be resolving subpackages.
  // The default excludes will skip all of node_modules.
  // Generate a custom config file with just the right directories.

  const namesToCover = packages.map(({ name }) => name)
    // Contracts are tested as part of polymer-resin.
    .filter((name) => name !== 'pug-contracts-trusted-types');
  const includePattern = `node_modules/@(${ namesToCover.join('|') })/**/*.js`;

  const istanbulConfig = `#!/bin/bash
./node_modules/.bin/istanbul cover \\
  -no-default-excludes \\
  -i '${ includePattern }' \\
  ./node_modules/.bin/_mocha
`;

  wf(path.join(root, '.istanbul.sh'), istanbulConfig);
}

if (require.main === module) {
  // TODO: push new polymer-resin and reenable
  // fetchContracts();

  console.log('');
  console.log('COMPUTING PACKAGE ORDER');
  const packages = computePackageOrder();

  updatePackageMetadata(packages, false);

  console.log('');
  console.log(`INSTALLING SUBPACKAGES ${ packages.map(({ name }) => name) } LOCALLY`);
  installLocally(packages);

  console.log('');
  console.log('COMPUTING COVERAGE CONFIG');
  computeCoverageConfig(packages);

  console.log('');
  console.log('DONE');
}
