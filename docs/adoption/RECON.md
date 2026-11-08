# RECON (2026-11-01)

## Sources read
- `the upstream repo@main`: Astro 7 + Hono 4 Worker, Pages proxy, 11 Supabase migrations (multi-company since 006), Python pipeline (Meta, Google Ads, Snap, GA4, TikTok via MCP), modules (observe, suggest, critic, execute, learn, outcomes, targets), workflows ci/deploy/refresh/pipeline/db-backup/execute-smoke.
- `leen-saz/eng-policies` 1.0.0-alpha.1: reusable ci/deploy/preview/codeql workflows. Pin by SHA.
- `leen-saz/hoven-dashboard` (~1,900 lines): one `template.html` (ECharts) built daily by `publish.sh` on one machine, pushed to GitHub, deployed by Vercel. Single shared password (PBKDF2 hash in repo, 30-day cookie). Sources: Meta (`act_1138203691250445` main, `act_332630232618853` legacy), Snap, Google Ads (`4780406294`), Salla API + webhook (tokens AES-encrypted in Vercel Blob), Meta/IG/X organic. History CSVs since 2023-08-29. Supabase schema with 7 tables.

## Risks
1. `the upstream repo` and `leen-saz/eng-policies` are **public**. No key-format matches found in a scan, but the owner email and architecture are readable.
2. The old Hoven data refresh depends on one machine; if it is off, data stops. The new system removes this.
3. Old Hoven Salla tokens live in Vercel Blob; they move to Supabase Vault (Leen re-authorises the Salla app).
4. Supabase org `hoven` now holds 3 projects (`hoven` inactive, `hoven-dashboard`, `hoven-ads`); free plan allows 2 active.
5. Cloudflare account is shared with upstream: 100k requests/day shared.

## Env / secret names (names only)
Worker: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`), `SESSION_SECRET`, `OWNER_EMAIL` (var).
Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `SNAP_CLIENT_ID`, `SNAP_CLIENT_SECRET`, `SNAP_REFRESH_TOKEN`, `SNAP_AD_ACCOUNT_ID`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_CUSTOMER_ID`, `SALLA_CLIENT_ID`, `SALLA_CLIENT_SECRET`.
