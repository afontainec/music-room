#!/usr/bin/env bash
# Prints a Markdown report of a Claude Code run from its execution file (the action's
# `execution_file` output): turns, cost, the tool calls permissions refused, and Claude's final
# message. The action itself logs only the count of refused calls, so without this a run that
# stops early leaves no trace of why. Usage: claude-run-report.sh <execution file>
set -euo pipefail
file=$1

# The file holds the run's messages; the last "result" message has the summary.
result='(if type == "array" then . else [.] end) | map(select(.type? == "result")) | last // {}'

echo "## Claude run report"
echo
jq -r "$result"' | "Turns: \(.num_turns // "?"), cost: $\(.total_cost_usd // "?"), ended as: \(.subtype // "?")"' "$file"
echo
echo "### Refused tool calls"
echo
jq -r "$result"' | (.permission_denials // []) | if length == 0 then "None." else .[] | "- `\(.tool_name)`: `\((.tool_input.command // (.tool_input | tostring)) | gsub("[\n`]"; " ") | .[0:300])`" end' "$file"
echo
echo "### Final message"
echo
jq -r "$result"' | .result // "(none)"' "$file"
