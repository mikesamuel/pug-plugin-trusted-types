#!/bin/bash

set -ev

export DEST_DIRNAME="$(dirname "$(dirname "$0")")/lib/contracts"
echo "DEST_DIRNAME=$DEST_DIRNAME"
[ -d "$DEST_DIRNAME" ]

# Fetch contracts
echo TMP_DIRNAME="$(mktemp -d)"
pushd "$TMP_DIRNAME"
npm install --no-save polymer-resin
cp node_modules/polymer-resin/LICENSE "$DEST_DIRNAME"/
(cat node_modules/polymer-resin/lib/contracts/contracts.js | perl -pe \
 'if (/^goog[.](provide|module)/) {
    $_ = "const security = { html: { contracts: {} } };\n";
  }' \
 && echo && echo '
module.exports = {
  contentTypeForElement: security.html.contracts.contentTypeForElement,
  isEnumValueAllowed: security.html.contracts.isEnumValueAllowed,
  typeOfAttribute: security.html.contracts.typeOfAttribute,
}') > "$DEST_DIRNAME"/contracts.js
popd
rm -rf "$TMP_DIRNAME"


# Run linter and tests
npm test
npm run lint

