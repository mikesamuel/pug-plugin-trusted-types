#!/usr/bin/env node

/* eslint no-console: 0, no-sync: 0 */

'use strict';

const childProcess = require('child_process');
// eslint-disable-next-line id-length
const fs = require('fs');
const path = require('path');
const process = require('process');

const packageMetadata = require('../package.json');

if (process.argv.length <= 1) {
  console.log(`Usage: ${ process.argv[0] } <new-version-spec>

<new-version-spec>: One of
  - a semver version
  - 'major', 'minor', 'patch' same meaning as npm version
  - 'current' to not change the version
`);
}

const [ , , versionSpec, ...unused ] = process.argv;

if (unused.length) {
  throw new Error(`Unexpected arguments ${ JSON.stringify(unused) }`);
}

let newVersion = null;

if (/^\d+\.\d+\.\d+(?:-\w+)?$/.test(versionSpec)) {
  newVersion = versionSpec;
} else {
  const [ , major, minor, patch, suffix ] = /^(\d+)\.(\d+)\.(\d+)(-\w+)?$/
    .exec(packageMetadata.version);
  let newMajor = Number(major);
  let newMinor = Number(minor);
  let newPatch = Number(patch);
  switch (versionSpec) {
    case 'major':
      ++newMajor;
      break;
    case 'minor':
      ++newMinor;
      break;
    case 'patch':
      ++newPatch;
      break;
    case 'current':
      break;
    default:
      throw new Error(`Unsupported version specifier: ${ versionSpec }`);
  }
  newVersion = `${ newMajor }.${ newMinor }.${ newPatch }${ suffix || '' }`;
}
console.log(`Using new version ${ newVersion }`);

const packages = Object.create(null);

// Fetch the set of subpackages and metadata
const packagesDir = path.join(__dirname, '..', 'packages');
for (const dirname of fs.readdirSync(packagesDir)) {
  const packageDir = path.join(packagesDir, dirname);
  const subpackageMetadataPath = path.join(packageDir, 'package.json');
  if (fs.existsSync(subpackageMetadataPath)) {
    // eslint-disable-next-line global-require
    const subpackageMetadata = require(subpackageMetadataPath);
    packages[subpackageMetadata.name] = {
      metadata: subpackageMetadata,
      dirname: packageDir,
      metadataPath: subpackageMetadataPath,
    };
  }
}

// Update version and sync internal dependency versions.
const changedFiles = [];
for (const packageName in packages) {
  console.group(`Updating version of ${ packageName }`);
  const { metadata, metadataPath } = packages[packageName];
  metadata.version = newVersion;
  if (metadata.dependencies) {
    for (const dep of Object.getOwnPropertyNames(metadata.dependencies)) {
      if (dep in packages) {
        console.log(`Updating dependency ${ dep }`);
        metadata.dependencies[dep] = `^${ newVersion }`;
      }
    }
  }
  console.log('Writing updated metadata');
  fs.writeFileSync(
    metadataPath,
    `${ JSON.stringify(metadata, null, 2) }\n`,
    { encoding: 'UTF-8' });
  console.groupEnd();
  changedFiles.push(metadataPath);
}

// Update the monorepo metadata
{
  for (const dep of Object.getOwnPropertyNames(packageMetadata.dependencies)) {
    if (dep in packages) {
      packageMetadata.dependencies[dep] = `^${ newVersion }`;
    }
  }
  changedFiles.push(
    path.join(__dirname, '..', 'package.json'),
    path.join(__dirname, '..', 'package-lock.json'));
}

// Commit metadata changes
if (changedFiles.length) {
  console.log('Committing metadata changes.');
  const { exc, status, signal } = childProcess.spawnSync(
    'git', [ 'commit', '-n', '-m', `Bumped version to ${ newVersion }`, ...changedFiles ],
    {
      stdio: [ 'ignore', 'inherit', 'inherit' ],
      shell: false,
    });
  if (exc || status || signal) {
    if (exc) {
      console.error(exc);
    }
    if (status || signal) {
      console.error(`git commit exited with status ${ status }, signal ${ signal }`);
    }
    throw new Error('git commit failed');
  }
}


// Call out to `npm` to bump the version of the monorepo project and tag it.
{
  console.log('Calling out to `npm version`.');
  const { exc, status, signal } = childProcess.spawnSync(
    'npm', [ 'verson', newVersion ],
    {
      stdio: [ 'ignore', 'inherit', 'inherit' ],
      shell: false,
    });
  if (exc || status || signal) {
    if (exc) {
      console.error(exc);
    }
    if (status || signal) {
      console.error(`npm version exited with status ${ status }, signal ${ signal }`);
    }
    throw new Error('npm version failed');
  }
}


console.log(`
Versions are synced to ${ newVersion }!

To finish publishing, run:

for dir in ${ Object.entries(packages).map(([ , { dirname } ]) => dirname).join(' ') }; do
  pushd "$dir"
  npm publish
  popd
done

git push origin master --tags
`);
