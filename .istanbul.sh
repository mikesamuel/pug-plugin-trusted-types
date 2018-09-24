#!/bin/bash
./node_modules/.bin/istanbul cover \
  -no-default-excludes \
  -i 'node_modules/pug-guards-trusted-types/**/*.js' \
  -i 'node_modules/pug-plugin-trusted-types/**/*.js' \
  -i 'node_modules/pug-require/**/*.js' \
  -i 'node_modules/pug-runtime-trusted-types/**/*.js' \
  -i 'node_modules/pug-scrubber-trusted-types/**/*.js' \
  ./node_modules/.bin/_mocha
