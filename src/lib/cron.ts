// Hourly trigger for the data refresh. GitHub never fired the `schedule` of this repo, so a Cloudflare Cron
// Trigger (production only, minute 7) starts .github/workflows/refresh.yml through the GitHub API instead.
// Needs the Worker secret GH_DISPATCH_TOKEN: a fine-grained token on leen-saz/hoven with Actions: Read and write.
export interface CronEnv { GH_DISPATCH_TOKEN?: string }

export const DISPATCH_URL = 'https://api.github.com/repos/leen-saz/hoven/actions/workflows/refresh.yml/dispatches';
// Upstream commits arrive here as a PR (.github/workflows/upstream-well.yml), checked with the same hourly trigger
export const UPSTREAM_URL = 'https://api.github.com/repos/leen-saz/hoven/actions/workflows/upstream-well.yml/dispatches';

export async function dispatchRefresh(e: CronEnv, f: typeof fetch = fetch, url = DISPATCH_URL): Promise<number> {
  const token = (e.GH_DISPATCH_TOKEN || '').trim();
  if (!token) { console.error('cron: GH_DISPATCH_TOKEN missing, refresh not started'); return 0; }
  const res = await f(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'user-agent': 'hoven-cron', 'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (res.status !== 204) console.error('cron: dispatch failed', res.status);
  else console.log('cron: started', url.split('/').slice(-2, -1)[0]);
  return res.status;
}
