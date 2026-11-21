import { Hono } from 'hono';
import { actions, middleware, notFound, pages, i18n } from 'astro/hono';
import { cf } from '@astrojs/cloudflare/hono';
import { api } from './api/index';
import { mcp } from './mcp/index';
import { gate } from './lib/gate';
import type { AuthEnv } from './lib/auth';
import { withSecurityHeaders } from './lib/headers';
import { serveSite } from './lib/site';
import { versionAssets } from './lib/assets';
import { withTheme } from './lib/theme';
import { withWaiter } from './lib/usage';
import { dispatchRefresh, type CronEnv } from './lib/cron';
import { runListening, type ListenEnv } from './modules/listening/fetcher';
import { runSocial } from './modules/social/cron';
import { runBuyerLearning } from './modules/buyer/learn';
import { runAccountHealth } from './lib/account-health';
import { env as cfgOf } from './lib/auth';
// Cloudflare Workflows: the class must be exported from the Worker entry
export { JourneyRun } from './modules/journeys/workflow';

type Bindings = Env & AuthEnv;
const SOCIAL_CRON = '*/5 * * * *';

// Requests produced by a gateway rewrite (department or creative copy) skip the gateway the second time.
const REWRITTEN = new WeakSet<Request>();

// One Worker: the gateway runs first, then Hono serves /api/*, then the dashboards from R2, then Astro pages.
const app = new Hono<{ Bindings: Bindings }>();

app.use(async (c, next) => {
  await next();
  c.res = withSecurityHeaders(c.res);
});
// Cost records (src/lib/usage.ts) are written after the answer: this gives them the request's waitUntil
app.use(async (c, next) => {
  let wait: ((p: Promise<unknown>) => void) | undefined;
  try { const ctx = c.executionCtx; wait = p => ctx.waitUntil(p); } catch { /* no execution context (tests) */ }
  return wait ? withWaiter(wait, next) : next();
});
// Pages load our scripts and styles from their versioned, immutable copies
app.use(async (c, next) => {
  await next();
  c.res = versionAssets(c.res);
});
// The theme script goes in first (registered after, so it runs before versionAssets rewrites the page)
app.use(async (c, next) => {
  await next();
  c.res = withTheme(c.res);
});
app.use(async (c, next) => {
  if (REWRITTEN.has(c.req.raw)) return next();
  const d = await gate(c.req.raw, c.env);
  if (d instanceof Response) return d;
  if (d.rewrite) {
    const req = new Request(d.rewrite, c.req.raw);
    REWRITTEN.add(req);
    return app.fetch(req, c.env, c.executionCtx);
  }
  return next();
});
app.route('/', mcp);
app.route('/', api);
// Dashboards built by the pipeline, from R2 (phase 4.1)
app.use(async (c, next) => {
  let wait: ((p: Promise<unknown>) => void) | undefined;
  try { const ctx = c.executionCtx; wait = p => ctx.waitUntil(p); } catch { /* no execution context (tests) */ }
  return (await serveSite(c.req.raw, c.env.FILES, wait)) ?? next();
});
app.use(cf());
app.use(notFound());
app.use(actions());
app.use(middleware());
app.use(i18n());
app.use(pages());

// The buyer's learning run never stops the refresh: a missing setup or a failure is logged and skipped
async function health(e: AuthEnv): Promise<void> {
  try { await runAccountHealth(cfgOf(e)); } catch (err) { console.error('account health failed', (err as Error).message); }
}
async function learn(e: AuthEnv): Promise<void> {
  try { await runBuyerLearning(cfgOf(e)); } catch (err) { console.error('buyer learning failed', (err as Error).message); }
}

export default {
  fetch: app.fetch,
  // Cloudflare Cron Triggers (production only): the hourly data refresh on GitHub Actions, and every 5 minutes the due social posts
  scheduled(event: ScheduledController, env: CronEnv & AuthEnv, ctx: ExecutionContext) {
    // Every 5 minutes: due social posts, then one social-listening keyword that has not been fetched in a day
    // Every 4 hours: the data refresh, and the media buyer measures its decided proposals (3 and 7 days on) and writes lessons
    // The 5-minute run in the first 5 minutes of each hour also checks the connected accounts (hourly, apart from the pull)
    const hourly = new Date(event.scheduledTime).getUTCMinutes() < 5;
    withWaiter(p => ctx.waitUntil(p), () => ctx.waitUntil(event.cron === SOCIAL_CRON ? Promise.all([runSocial(env), runListening(env as ListenEnv), ...(hourly ? [health(env)] : [])])
      : Promise.all([dispatchRefresh(env), learn(env)])));
  },
};
