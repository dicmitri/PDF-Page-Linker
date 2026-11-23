#!/bin/sh
# Build the Chrome Web Store package from the committed tree:
#   ./package.sh            -> dist/pdf-page-linker-<version>.zip
# Only the extension's runtime files go in; tests, docs, store images and
# this script stay out. (This is done here rather than with export-ignore in
# .gitattributes, because GitHub's "Download ZIP" honours that too and would
# leave those folders out of downloads of the repository.)
set -eu
cd "$(dirname "$0")"

version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' manifest.json)
out="dist/pdf-page-linker-${version}.zip"

if ! git diff --quiet HEAD -- || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "Note: uncommitted changes are not included; the ZIP is built from HEAD." >&2
fi

mkdir -p dist
git archive --format=zip --output="$out" HEAD -- . \
  ':(exclude)tests' \
  ':(exclude)store-assets' \
  ':(exclude)*.md' \
  ':(exclude)PRIVACY.html' \
  ':(exclude)package.sh' \
  ':(exclude).gitignore'

echo "$out"
unzip -l "$out" | tail -n 1
