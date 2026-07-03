#!/usr/bin/env bash
set -euo pipefail

rm -rf dist
mkdir -p dist

cp ./*.html dist/
cp ./*.css dist/
cp ./*.js dist/

cp ./favicon*.png ./favicon.ico ./apple-touch-icon.png dist/

mkdir -p dist/Imagenes
cp -R Imagenes/. dist/Imagenes/

VERSION="${WORKERS_CI_COMMIT_SHA:-${CF_PAGES_COMMIT_SHA:-$(date +%s%3N)}}"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > dist/version.json <<EOF
{
  "v": "${VERSION}",
  "builtAt": "${BUILT_AT}"
}
EOF
