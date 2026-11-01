# Plan progress

| Phase | Status | Notes |
|---|---|---|
| 0 Foundation | done | PRD, plan, RECON. Supabase `hoven-ads` created; repo created; Cloudflare = Leen@brandsforhome.sa |
| 1 Skeleton + CI | done | Well codebase ported (all modules), Hoven colours + fonts, names and buckets renamed; build, typecheck, lint, 76 TS + 106 Python tests green |
| 2 Auth | done | Owner login verified on staging (profile + audit row) |
| 3 Data | done | Sales columns (ADR-0007), Salla pipeline + connector, migration 012 applied, Salla history seed |
| 4 Dashboards | done | ROAS + Salla KPIs, one Hoven department, organic accounts |
| 5 Control + Connectors | done | Ported from Well; Salla added; Google developer token sent |
| 5b Well modules | done | journeys, maestro, social, content ported |
| 6 Cutover | ready | docs/cutover.md; needs Leen (secrets, "انشر الإنتاج", connect platforms) |
| 7 Tighten | not started | 7 days after cutover |

## Decisions
- 2026-11-01: Google Ads account `4780406294` counts 100% as Hoven.
- 2026-11-01: Build on the latest Well; only fonts and colours come from Hoven.
- 2026-11-01: Port every Well module (journeys, maestro, social, content).
- 2026-11-01: Everything on Brands for Home accounts.

## Waiting on Leen
- Delete inactive Supabase project `hoven`.
