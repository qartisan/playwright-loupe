#!/usr/bin/env bash
# Runs the checks of .github/workflows/checks.yml, in the same order, in a
# clean copy of the working tree: no node_modules, no dist, no .git of the
# repository. It catches what passes locally only because of local state: a
# dist/ a test imports before the build, a variable a snapshot reads.
#
#   scripts/ci-order.sh [copy folder]
#
# The copy holds every tracked and untracked (not ignored) file, uncommitted
# changes included, so a part can be checked before it is committed. The
# folder must be outside any git repository, and absent, empty or an earlier
# copy (which is replaced); by default it is a new temporary folder. It gets a
# throwaway git repository with one commit, as a CI checkout has one
# (test/history.integration.test.ts reads HEAD). Then: npm ci, typecheck,
# build, npm test, the fixture suite, and the history and leak canary tests
# again under simulated GitHub Actions variables.
#
# Never runs anything in the repository itself. Needs GNU coreutils (Linux)
# and Chromium installed (npx playwright install chromium), as in CI.
set -euo pipefail

REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
DEST="$(realpath -m "${1:-$(mktemp -d "${TMPDIR:-/tmp}/loupe-ci-order.XXXXXX")}")"

case "$DEST/" in
  "$REPO/"*) echo "ci-order: refusing: $DEST is inside the repository" >&2; exit 1 ;;
esac
case "$REPO/" in
  "$DEST/"*) echo "ci-order: refusing: $DEST contains the repository" >&2; exit 1 ;;
esac

# Before anything is removed: the copy must be outside every git repository...
ancestor="$DEST"
while [ ! -d "$ancestor" ]; do ancestor="$(dirname "$ancestor")"; done
if git -C "$ancestor" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "ci-order: refusing: $DEST is inside a git repository ($(git -C "$ancestor" rev-parse --show-toplevel))" >&2
  exit 1
fi
# ...and a folder this script made, or an empty one.
if [ -d "$DEST" ] && [ -n "$(ls -A "$DEST")" ] && [ ! -e "$DEST/.ci-order" ]; then
  echo "ci-order: refusing: $DEST is not empty and was not made by ci-order" >&2
  exit 1
fi

echo "== copy of $REPO into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
touch "$DEST/.ci-order"
(cd "$REPO" && git ls-files -co --exclude-standard -z | grep -zv -E '^(node_modules|dist)/' | xargs -0 cp --parents -t "$DEST")

cd "$DEST"
test ! -e node_modules && test ! -e dist
git init -q
git add -A
git -c user.name=ci-order -c user.email=ci-order@localhost commit -q -m "ci-order copy"
test "$(git rev-parse --show-toplevel)" = "$DEST"

start=$(date +%s)
echo "== npm ci"
npm ci --no-audit --no-fund
rm -rf dist
echo "== typecheck"
npm run typecheck
echo "== build"
npm run build
echo "== test"
npm test
echo "== fixtures"
npm run fixtures

echo "== history and leak canary under simulated GitHub Actions"
env CI=true GITHUB_ACTIONS=true \
  GITHUB_RUN_ID=12345678 GITHUB_RUN_ATTEMPT=1 \
  GITHUB_SHA="$(git rev-parse HEAD)" GITHUB_REF_NAME=feat/ci-order GITHUB_HEAD_REF= \
  GITHUB_REPOSITORY=qartisan/playwright-loupe GITHUB_SERVER_URL=https://github.com \
  npx vitest run test/history test/leak.integration.test.ts

echo "== ci-order: all checks passed in $(( $(date +%s) - start )) s, Node $(node -v), $(npx playwright --version)"
