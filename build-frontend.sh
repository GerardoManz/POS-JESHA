#!/usr/bin/env bash
set -euo pipefail

rm -rf dist
mkdir -p dist

cp ./*.html dist/
cp ./*.css dist/
cp ./*.js dist/

mkdir -p dist/Imagenes
cp -R Imagenes/. dist/Imagenes/

VERSION="${WORKERS_CI_COMMIT_SHA:-${CF_PAGES_COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}}"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > dist/version.json <<EOF
{
  "version": "${VERSION}",
  "buildTime": "${BUILD_TIME}"
}
EOF
