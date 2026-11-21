// Every 5 minutes (Worker cron): publish the posts that are due, through Hoven's MCP server (src/mcp/tools/social.ts,
// tool social.publish). Each post is claimed first (scheduled -> publishing) so two runs never publish it twice. What each
// platform has done is written down as it happens (social_posts.results), which is what makes three things safe:
//  - a video that Instagram is still preparing comes back 'scheduled' and the next run continues it (bounded: VIDEO_WAIT_MS);
//  - a post stuck in 'publishing' (the Worker died mid-way) is re-claimed after STALE_MS and finished from its stored results:
//    what went out is never repeated, what never started starts, what may have gone out is marked 'unconfirmed' for a person to decide;
//  - a retry of the failed platforms (routes.ts) goes through the same path with the failed entries cleared.
import { env, type AuthEnv } from '../../lib/auth';
import { cronCtx } from '../../mcp/core';
import { runDue } from '../../mcp/tools/social';

export async function runSocial(e: AuthEnv, now = Date.now(), f: typeof fetch = fetch): Promise<number> {
  let cfg;
  try { cfg = env(e); } catch { console.error('social: setup incomplete'); return 0; }
  return runDue(cronCtx(cfg, f), now);
}
