#!/usr/bin/env bash
# Brings new commits from the Well repo (leen-saz/well-ads, main) into this repo as one pull request.
# Names, buckets, cookies, owner email, colours and fonts are rewritten for Hoven (.upstream/well-to-hoven.pl).
# Hunks that do not apply cleanly are kept as .rej files and listed in the PR, never dropped silently.
# Leen reviews and merges the PR ("ادمج"); nothing here merges or deploys.
set -euo pipefail
UP="${UP_REPO:-https://github.com/leen-saz/well-ads}"
BASE="$(tr -d '[:space:]' < .upstream/well.sha)"
git fetch --quiet --no-tags "$UP" main
HEAD="$(git rev-parse FETCH_HEAD)"
if [ "$BASE" = "$HEAD" ]; then echo "up to date with Well ($HEAD)"; exit 0; fi
BRANCH="upstream/well-${HEAD:0:7}"
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then echo "PR branch $BRANCH already exists"; exit 0; fi

# Well-only files never come over: its PRD/plan/docs, departments, generated pages, CRM, design notes
EXCLUDE=(':!docs/prd.md' ':!docs/plan.md' ':!docs/plan-progress.md' ':!docs/cutover.md' ':!README.md' ':!pipeline/config/departments.json'
         ':!pipeline/web/public' ':!pipeline/well-ads-dashboard.html' ':!pipeline/crm' ':!pipeline/tests/test_crm_fetch.py' ':!pipeline/tests/test_crm_join.py' ':!supabase/migrations' ':!.github/workflows' ':!tests/parity' ':!playwright.config.ts' ':!docs/reports' ':!docs/crm-booking-message.md' ':!src/modules/overview/journey.test.ts' ':!playwright.smoke.config.ts')
PATCH="$(mktemp)"; BIN="$(mktemp)"
git diff --no-color "$BASE" "$HEAD" -- . "${EXCLUDE[@]}" | perl .upstream/well-to-hoven.pl > "$PATCH"
git diff --numstat "$BASE" "$HEAD" -- . "${EXCLUDE[@]}" | awk '$1=="-"{print $3}' > "$BIN"   # binary files: listed, not applied

git checkout -q -b "$BRANCH"
git apply --reject --whitespace=nowarn "$PATCH" 2>apply.log || true
# A hunk that did not apply: merge the whole file three ways (Well before -> Well now, onto Hoven's file), so Well's
# change lands and Hoven's edits stay. Only real conflicts are left, marked, and listed in the PR.
REJ=()
while IFS= read -r r; do
  f="${r#./}"; f="${f%.rej}"; rm -f "$r"
  T="$(mktemp -d)"
  git show "HEAD:$f" > "$T/hoven" 2>/dev/null || cp "$f" "$T/hoven"
  git show "$BASE:$f" 2>/dev/null | perl .upstream/well-to-hoven.pl > "$T/base"
  git show "$HEAD:$f" | perl .upstream/well-to-hoven.pl > "$f"
  git merge-file -L well -L base -L hoven "$f" "$T/base" "$T/hoven" || REJ+=("$f")
done < <(find . -name '*.rej' -not -path './node_modules/*' | sort)
python3 scripts/hoven-overlay.py   # Hoven's content changes (sales wording, store compliance, prompts, dashboard)
# Migration numbers: Well's next files get Hoven's next free numbers, so they never collide with Hoven's own
n=$(ls supabase/migrations | sed -n 's/^\([0-9]\{3\}\)_.*/\1/p' | sort -n | tail -1)
for m in $(git diff --name-only --diff-filter=A "$BASE" "$HEAD" -- supabase/migrations); do
  n=$(printf '%03d' $((10#$n + 1))); b="$(basename "$m")"; git show "$HEAD:$m" | perl .upstream/well-to-hoven.pl > "supabase/migrations/${n}_${b#*_}"
  echo "Well $b -> Hoven ${n}_${b#*_} (apply to hoven-ads before production; add ['${b%.sql}','${n}_${b#*_}'] without the .sql to .upstream/well-to-hoven.pl)" >> migrations.log
done
echo "$HEAD" > .upstream/well.sha
LOG="$(git log --format='- %h %s' "$BASE..$HEAD" 2>/dev/null || true)"
git add -A -- . ':!apply.log' ':!migrations.log'
git -c user.name="hoven-upstream-bot" -c user.email="actions@users.noreply.github.com" commit -q -m "chore(upstream): Well ${BASE:0:7}..${HEAD:0:7}"
git push -q origin "$BRANCH"

{
  echo "## What changed"
  echo "New commits on Well's main (\`leen-saz/well-ads\`) since \`${BASE:0:7}\`, rewritten for Hoven:"
  echo; echo "$LOG"; echo
  echo "## Needs a look"
  if [ ${#REJ[@]} -gt 0 ]; then echo "Files with merge conflicts (marked with <<<<<<< in this branch; resolve before merging):"; printf -- '- `%s`\n' "${REJ[@]}"; else echo "- Every change applied (three-way merge where needed), and the Hoven overlay ran."; fi
  if [ -s migrations.log ]; then echo "- New migrations, renumbered for Hoven:"; sed 's/^/  - /' migrations.log; fi
  if [ -s "$BIN" ]; then echo "- Binary files changed in Well, not copied:"; sed 's/^/  - `/; s/$/`/' "$BIN"; fi
  WF="$(git diff --name-only "$BASE" "$HEAD" -- .github/workflows)"
  if [ -n "$WF" ]; then echo "- Workflow files changed in Well (GitHub does not let Actions edit them; port by hand):"; echo "$WF" | sed 's/^/  - `/; s/$/`/'; fi
  echo "- Well-only paths are skipped: PRD/plan/cutover docs, departments, CRM, generated pages."
  echo "- Check Hoven-specific behaviour (sales columns, ADR-0007) in touched files."
  echo; echo "## How tested"; echo "CI on this PR."
  echo; echo "## What Leen must do"; echo "Review, then write \"ادمج\". New migrations must be applied to hoven-ads before production."
} > pr.md
gh pr create --base main --head "$BRANCH" --title "Upstream from Well: ${BASE:0:7}..${HEAD:0:7}" --body-file pr.md
