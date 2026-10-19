#!/usr/bin/env bash
# Prints a Markdown summary of the last Playwright run (test-results/results.json).
# Reads OUTCOME, ARTIFACT_URL and RUN_URL from the environment.
set -euo pipefail

results=test-results/results.json

echo "<!-- e2e-summary -->"
if [ "${OUTCOME:-}" = success ]; then
  echo "## ✅ E2E tests passed"
else
  echo "## ❌ E2E tests failed"
fi
echo

if [ -f "$results" ]; then
  jq -r '.stats | "\(.expected) passed, \(.unexpected) failed, \(.flaky) flaky, \(.skipped) skipped"' "$results"
  echo
  jq -r '.. | objects | select(has("ok") and has("tests"))
    | "- \(if .ok then "✅" else "❌" end) \(.title) (`\(.file)`)"' "$results"
  echo
else
  echo "No test results were produced; see the run log."
  echo
fi

if [ -n "${ARTIFACT_URL:-}" ]; then
  echo "**Recording:** [download the Playwright report]($ARTIFACT_URL), unzip it and run \`npx playwright show-report <folder>\`. Failed tests include a video and a step-by-step trace; the walkthrough of this PR is in the Demo comment."
  echo
fi
echo "[Workflow run](${RUN_URL:-})"
