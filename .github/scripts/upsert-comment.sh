#!/usr/bin/env bash
# Creates or updates this workflow's own comment on a pull request, found by a hidden marker,
# so each workflow keeps exactly one comment however often it runs.
# Usage: upsert-comment.sh <pr number> <marker> <body file>. Needs GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail
pr=$1 marker=$2 file=$3

id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --paginate \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"$marker\"))) | .id" | head -n 1)
if [ -n "$id" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F body=@"$file" > /dev/null
else
  gh pr comment "$pr" --body-file "$file"
fi
