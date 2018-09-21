#!/bin/bash

set -e

export DEST_DIRNAME="$(dirname "$(dirname "$0")")/packages/contracts"
echo "DEST_DIRNAME=$DEST_DIRNAME"
[ -d "$DEST_DIRNAME" ]

# Fetch contracts
echo TMP_DIRNAME="$(mktemp -d)"
pushd "$TMP_DIRNAME"
if npm install --no-save polymer-resin; then
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
}') > "$DEST_DIRNAME"/index.js
fi
popd
rm -rf "$TMP_DIRNAME"


# Find packages and order them so we can install them locally
declare -a PACKAGES
for package in packages/*; do
    if [ -f "$package"/package.json ]; then
        PACKAGES=(${PACKAGES[@]} "$package")
    fi
done

export PACKAGE_ORDER="$(perl -e '
use strict;

my @packageDirs = @ARGV;
my %dirToName;
my %nameToDir;
my %deps;

foreach my $packageDir (@packageDirs) {
  my $packageJson = qq(./$packageDir/package.json);
  my $packageName = qx(node -e \x27console.log(require(`$packageJson`).name)\x27) || die;
  $dirToName{$packageDir} = $packageName;
  $nameToDir{$packageName} = $packageDir;
  my @packageDeps = split(/\n/,
    qx(node -e \x27console.log(Object.getOwnPropertyNames(require(`$packageJson`).dependencies || {}).join(`\n`))\x27));
  $deps{$packageName} = @packageDeps;
}

my %seen = ();
my @inOrder = ();

sub order($) {
  my $packageName = $_[0];
  if (!exists($seen{$packageName}) && exists($nameToDir{$packageName})) {
    $seen{$packageName} = 1;
    foreach my $dep ($deps{$packageName}) {
      order($dep);
    }
    push(@inOrder, $packageName);
  }
}
foreach my $packageDir (@packageDirs) {
  order($dirToName{$packageDir});
}

foreach my $packageName (@inOrder) {
  print qq($nameToDir{$packageName}\n);
}
' ${PACKAGES[@]})"
PACKAGES=( $PACKAGE_ORDER )

echo
echo
echo INSTALLING SUBPACKAGES ${PACKAGES[@]} LOCALLY
cp package.json{,.saved}
cp package-lock.json{,.saved}
# Build and install packages in dependency order
for package in ${PACKAGES[@]}; do
    echo PACKING "$package"
    (
        pushd "$package"
        TARBALL="$package/$(npm pack)"
        PACKAGE_NAME="$(node -e 'console.log(require(`./package.json`).name)')"
        popd
        HASH="$(shasum -a 256 "$TARBALL")"
        HASHFILE="node_modules/.$(basename "$package").sha256"
        if [ -f "$HASHFILE" ] && [ "$HASH" == "$(cat "$HASHFILE")" ]; then
            true
        else
            echo INSTALLING "$package" to node_modules/"$PACKAGE_NAME"
            npm uninstall "$PACKAGE_NAME"
            npm install "$TARBALL"
            echo -n "$HASH" > "$HASHFILE"
        fi
    )
done
mv package.json{.saved,}
mv package-lock.json{.saved,}

echo
echo
echo COMPUTING COVERAGE CONFIG
(
    echo \
'./node_modules/.bin/istanbul cover \
  -no-default-excludes \'

    perl -e '
    use strict;

    my @packageDirs = @ARGV;
    my %packageNames = ();
    foreach my $packageDir (@packageDirs) {
      next if $packageDir eq qq(packages/contracts);
      my $packageJson = qq(./$packageDir/package.json);
      my $packageName = qx(node -e \x27console.log(require(`$packageJson`).name)\x27) || die;
      chomp($packageName);
      print qq(  -i \x27node_modules/$packageName/**/*.js\x27 \\\n);
    }
    ' ${PACKAGES[@]}

    echo '  ./node_modules/.bin/_mocha'

) > .istanbul.sh

echo
echo DONE
