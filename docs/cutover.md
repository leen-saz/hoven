# Cutover: hoven-dashboard (Vercel) → hoven (Cloudflare)

The old system stays live and untouched until step 6, and for 7 days after it.

## Before (Leen, once)
1. **GitHub → leen-saz/hoven → Settings → Environments → `production`** secrets:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (same values as the Worker). Platform keys are not needed here:
   the Connectors page (Supabase Vault) wins over GitHub secrets.
2. **Production Worker secrets** (`hoven`, after the first production deploy): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SESSION_SECRET`, `GH_DISPATCH_TOKEN` (fine-grained token on `leen-saz/hoven`, Actions: Read and write only),
   and the app credentials for the Connect buttons: `META_APP_ID`, `META_APP_SECRET`, `SNAP_CLIENT_ID`, `SNAP_CLIENT_SECRET`,
   `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `SALLA_CLIENT_ID`, `SALLA_CLIENT_SECRET`.
3. **Redirect URL** in each app (Meta, Snap, Google Cloud, Salla Partners): `https://hoven.pages.dev/api/connectors/callback`.

## Steps
1. Deploy production: Actions → deploy → Run workflow → `production` (only after Leen writes "انشر الإنتاج").
2. Log in at https://hoven.pages.dev and connect Meta, Snap, Google Ads (+ Developer Token field), Salla, TikTok from the Connectors page.
3. Actions → refresh → Run workflow with **full = true**: pulls every ad account from the start, seeds the Salla history,
   then lists every Salla order since 2023.
4. Compare with the old dashboard for the same month: spend per platform, purchases, Salla orders and net sales.
   Differences above 1% are investigated before going on.
5. Stop the old writer: on the build box, disable the `publish.sh` schedule. Vercel keeps serving the last build.
6. Send the new link to the team.

## Rollback (one step)
Re-enable `publish.sh` on the build box. The old site and its Supabase project (`hoven-dashboard`) were never changed.

## After 7 days without rollback
Archive `leen-saz/hoven-dashboard`, remove the Vercel project, pause the `hoven-dashboard` Supabase project.
