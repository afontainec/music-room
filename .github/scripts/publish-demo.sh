#!/usr/bin/env bash
# Turns the demo videos of the last `npm run demo` into an MP4 and a GIF each, pushes them to
# the pr-media branch under pr-<number>/ and prints the pull request comment (Markdown).
# Needs PR_NUMBER, HEAD_SHA, GH_TOKEN and GITHUB_REPOSITORY, and ffmpeg (installed by demo.yml).
set -euo pipefail

marker='<!-- pr-demo -->'
results=test-results/results.json
out=$(mktemp -d)
raw="https://raw.githubusercontent.com/$GITHUB_REPOSITORY/pr-media/pr-$PR_NUMBER"
blob="https://github.com/$GITHUB_REPOSITORY/blob/pr-media/pr-$PR_NUMBER"

# One line per demo: title, then the path of its video.
jq -r '.. | objects | select(has("tests") and has("title")) | . as $spec
  | .tests[].results[-1].attachments[]? | select(.name == "video") | [$spec.title, .path] | @tsv' "$results" > "$out/videos.tsv"

body="$out/comment.md"
{
  echo "$marker"
  echo "## 🎬 Demo"
  echo
} > "$body"

while IFS=$'\t' read -r title video; do
  slug=$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | cut -c1-60 | sed 's/^-//; s/-$//')
  ffmpeg -loglevel error -y -i "$video" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$out/$slug.mp4"
  ffmpeg -loglevel error -y -i "$video" \
    -vf "fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer" \
    "$out/$slug.gif"
  {
    echo "### $title"
    echo
    echo "![$title]($raw/$slug.gif?v=$HEAD_SHA)"
    echo
    echo "[Watch the full-quality MP4]($blob/$slug.mp4)"
    echo
  } >> "$body"
done < "$out/videos.tsv"

echo "_Recorded by \`npm run demo\` against a local build of commit ${HEAD_SHA:0:7}._" >> "$body"

# Publish to the pr-media branch, replacing this PR's previous demo.
media="$out/media"
git init -q "$media"
git -C "$media" remote add origin "https://x-access-token:$GH_TOKEN@github.com/$GITHUB_REPOSITORY.git"
git -C "$media" config user.name 'github-actions[bot]'
git -C "$media" config user.email '41898282+github-actions[bot]@users.noreply.github.com'
if git -C "$media" fetch -q --depth 1 origin pr-media 2> /dev/null; then
  git -C "$media" checkout -q -b pr-media FETCH_HEAD
else
  git -C "$media" checkout -q --orphan pr-media
fi
rm -rf "$media/pr-$PR_NUMBER" && mkdir -p "$media/pr-$PR_NUMBER"
cp "$out"/*.mp4 "$out"/*.gif "$media/pr-$PR_NUMBER/"
git -C "$media" add -A
git -C "$media" commit -q -m "Demo for #$PR_NUMBER at ${HEAD_SHA:0:7}"
# Two PRs can publish at once; their folders never overlap, so a rebase always applies.
for attempt in 1 2 3; do
  git -C "$media" push -q origin pr-media && break
  git -C "$media" fetch -q --depth 1 origin pr-media && git -C "$media" rebase -q FETCH_HEAD
done

cat "$body"
