#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: npm run tag -- <version>"
  exit 1
fi

raw_version="$1"
normalized_version="$(printf '%s' "$raw_version" | tr -d '[:space:]' | sed -E 's/^[vV]+//')"

if [[ -z "$normalized_version" ]]; then
  echo "Error: version is empty after normalization."
  exit 1
fi

tag_name="v$normalized_version"

git checkout main
git pull --ff-only origin main

npm pkg set version="$normalized_version"
npm i

git add package.json package-lock.json
git commit -m "$tag_name"

# Ensure we tag from the latest main; fail if main advanced and requires manual rebase.
git pull --ff-only origin main
git tag "$tag_name"

git push origin main "$tag_name"
