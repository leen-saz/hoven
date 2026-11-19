# Plan — Hoven on upstream's stack

Source: `docs/prd-2026-11-01.md`. One branch + PR per piece; Leen approves each phase. Status in `docs/plan-progress.md`.
The old system (`leen-saz/hoven-dashboard` on Vercel) stays live and untouched until phase 6.

| Phase | Work | Done when |
|---|---|---|
| 0 Foundation | PRD, plan, RECON, ADR-0001; install `leen-saz/eng-policies` (CI, PR template, CODEOWNERS, Dependabot) | Leen approves |
| 1 Skeleton + CI | Port upstream's Astro + Hono skeleton, persistent Shell, `tokens.css` with Hoven colours/fonts; `wrangler.jsonc` staging/production with own R2; deploy workflow | Hello page on staging, CI green |
| 2 Auth | Port upstream auth (Supabase, HMAC `__Host-` cookie, roles, dashboards, audit) + upstream migrations 000/005 | Leen logs in on staging |
| 3 Data | Port upstream pipeline (Meta, Snap, Google Ads) + Hoven's Salla, social, extra Meta breakdowns; migrate history since 2023-08-29; Cron → `workflow_dispatch` hourly | Monthly totals match the old system |
| 4 Dashboards | Analytics, Sales, Creative, Organic as Astro pages in the Shell; Playwright number parity vs old site | Same numbers for the same period |
| 5 Control + Connectors | Decisions board (ROAS/CPA targets), connectors tab + Salla, Vault | Smoke test on staging |
| 5b upstream modules | Port journeys, maestro, social, content agent (migrations 007–010) | Each works on staging |
| 6 Cutover | `docs/cutover.md`: backup, stop `publish.sh`, first run, compare, switch, one-step rollback; old kept 7 days | Production live on `hoven.pages.dev` |
| 7 Tighten | Bug hunt, security review, archive `hoven-dashboard` and Vercel project | Leen approves |
