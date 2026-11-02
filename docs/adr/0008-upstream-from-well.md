# ADR-0008: Well is upstream; its new commits arrive here as pull requests

Status: accepted (2026-11-02)

- `.github/workflows/upstream-well.yml` runs `scripts/upstream-sync.sh` (hourly through the Worker cron, a 6-hourly
  schedule as fallback, or by hand).
- It diffs Well's main from the SHA in `.upstream/well.sha` to the new head, rewrites names, buckets, cookies,
  owner, colours and fonts with `.upstream/well-to-hoven.pl`, applies it on `upstream/well-<sha>` and opens a PR.
- Hunks that conflict with Hoven's own changes stay as `.rej` files listed in the PR; binary files are listed.
- Well-only paths are skipped (PRD/plan docs, departments, CRM, generated pages).
- Nothing merges or deploys by itself: Leen reviews and writes "ادمج".
- Another project copies the three files (workflow, script, `.upstream/`) and edits the rewrite table.
