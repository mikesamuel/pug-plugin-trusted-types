#!/bin/bash
./node_modules/.bin/istanbul cover \
  -no-default-excludes \
  -i 'node_modules/@(pug-guards-trusted-types|pug-plugin-trusted-types|pug-require|pug-runtime-trusted-types|pug-scrubber-trusted-types|pug-template-tag)/**/*.js' \
  ./node_modules/.bin/_mocha
