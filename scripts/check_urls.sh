#!/usr/bin/env bash
# Zero-broken-URL gate: every file path the old static site served
# (frozen in legacy_urls.txt) must still exist in dist/ after a build.
# Run after `npm run build`. Fails the build if anything is missing.
set -u
missing=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ ! -f "dist/$f" ]; then
    echo "MISSING: dist/$f"
    missing=1
  fi
done < legacy_urls.txt
if [ "$missing" -ne 0 ]; then
  echo "FAIL: some legacy URLs would 404 — do not deploy."
  exit 1
fi
echo "OK: all $(grep -c . legacy_urls.txt) legacy URLs present in dist/."
