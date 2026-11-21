// Social tools of Hoven's MCP server: publish an approved post when it is due (the cron, or Claude on Leen's behalf),
// and read a post's state. A post goes out only once its approver approved it (social.ts `due`); the tool claims the
// post first (scheduled → publishing) so two callers never publish it twice, and a post stuck in 'publishing' (its
// Worker died) is re-claimed after STALE_MS and finished from its stored results.
import { sb } from '../../lib/auth';
import { HOVEN_COMPANY, scoped } from '../../lib/tenant';
import { due, type Draft } from '../../modules/social/social';
import { publishPost, stale, type Results } from '../adapters/meta-social';
import { register, ToolError, vault, rows, event, type Ctx } from '../core';

type Post = Draft & { id: number; company_id: string; status: string; claimed_at?: string | null; results?: Results | null; approved_at?: string | null; approved_by?: string | null; company?: { social_approvers?: string[] | null } | null };

/** Claim, publish from the stored results, write the outcome. Null = not due, not approved, or another run has it. */
export async function publishDue(ctx: Ctx, p: Post, tokens: Record<string, string>, now = Date.now()): Promise<{ status: string; results: Results } | null> {
  const iso = new Date(now).toISOString();
  let claim;
  if (p.status === 'scheduled') {
    if (!due(p, p.company?.social_approvers || [], now)) return null;
    claim = await sb<Post[]>(ctx.cfg, `/rest/v1/social_posts?id=eq.${p.id}&status=eq.scheduled`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { status: 'publishing', claimed_at: iso } });
  } else if (p.status === 'publishing' && stale(p, now)) {
    const old = p.claimed_at ? `claimed_at=eq.${encodeURIComponent(p.claimed_at)}` : 'claimed_at=is.null';
    claim = await sb<Post[]>(ctx.cfg, `/rest/v1/social_posts?id=eq.${p.id}&status=eq.publishing&${old}`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { claimed_at: iso } });
    console.error('social: recovering a post stuck in publishing', p.id);
  } else return null;
  if (!claim.ok || !Array.isArray(claim.data) || !claim.data.length) return null;
  const patch = (body: Record<string, unknown>) => sb(ctx.cfg, `/rest/v1/social_posts?id=eq.${p.id}`, { method: 'PATCH', admin: true, body });
  const out = await publishPost(p, p.company_id === HOVEN_COMPANY ? tokens : {}, ctx.f, p.results || {}, { now, save: async results => { await patch({ results }); } });
  // pending = Instagram is still preparing a video: back to 'scheduled' (still approved, still due) and the next run goes on
  const status = out.status === 'pending' ? 'scheduled' : out.status;
  await patch({ status, results: out.results, claimed_at: null });
  if (status !== 'scheduled') await event(ctx, `social.${status}`, 'social.publish', { post: p.id, platforms: p.platforms });
  return { status, results: out.results };
}

const SEL = 'select=*,company:companies(social_approvers)';

register(
  {
    name: 'social.publish', title: 'نشر منشور معتمد', write: true,
    description: 'Publish one approved social post whose time has come (Facebook page, Instagram). A post that is not approved, not due, or already being published is left alone.',
    input: { type: 'object', required: ['post_id'], properties: { post_id: { type: 'integer' } } },
    run: async (ctx, i) => {
      const id = Number(i['post_id']);
      if (!Number.isInteger(id) || id <= 0) throw new ToolError(400, 'رقم المنشور مو صحيح');
      const p = rows<Post>((await sb(ctx.cfg, scoped(`/rest/v1/social_posts?${SEL}&id=eq.${id}`, ctx.co), { admin: true })).data)[0];
      if (!p) throw new ToolError(404, 'المنشور مو موجود');
      // The cron passes its own clock (tests); any other caller publishes as of now
      const now = ctx.agent === 'cron' && Number.isFinite(i['now']) ? Number(i['now']) : Date.now();
      const got = await publishDue(ctx, p, await vault(ctx.cfg, HOVEN_COMPANY), now);
      if (!got) throw new ToolError(409, p.approved_at ? 'المنشور مو وقته أو ينشر الحين' : 'المنشور ينتظر الموافقة');
      return { post_id: id, ...got };
    },
  },
  {
    name: 'social.get_post', title: 'حالة منشور', write: false,
    description: 'One social post: platforms, time, approval, status and what each platform answered (codes only).',
    input: { type: 'object', required: ['post_id'], properties: { post_id: { type: 'integer' } } },
    run: async (ctx, i) => {
      const id = Number(i['post_id']);
      const p = rows<Post>((await sb(ctx.cfg, scoped(`/rest/v1/social_posts?id=eq.${id}&select=id,platforms,body,publish_at,status,approved_at,approved_by,results`, ctx.co), { admin: true })).data)[0];
      if (!p) throw new ToolError(404, 'المنشور مو موجود');
      const results = Object.fromEntries(Object.entries(p.results || {}).map(([k, r]) => [k, { ok: r.ok, id: r.id, code: r.code, state: r.state }]));
      return { ...p, results };
    },
  },
);

/** The cron's round: every due post and every stale one, through publishDue (the same path, claim and checks as social.publish). */
export async function runDue(ctx: Ctx, now = Date.now()): Promise<number> {
  const iso = new Date(now).toISOString();
  const list = await sb<Post[]>(ctx.cfg, `/rest/v1/social_posts?${SEL}&status=eq.scheduled&publish_at=lte.${iso}&order=publish_at.asc&limit=50`, { admin: true });
  if (!list.ok || !Array.isArray(list.data)) return 0;
  const stuck = await sb<Post[]>(ctx.cfg, `/rest/v1/social_posts?${SEL}&status=eq.publishing&publish_at=lte.${iso}&order=publish_at.asc&limit=20`, { admin: true });
  // Platform tokens: the vault holds Hoven's today; per-company vault names come with ADR-0006's next step
  const tokens = await vault(ctx.cfg, HOVEN_COMPANY);
  let done = 0;
  for (const p of [...list.data, ...(stuck.ok && Array.isArray(stuck.data) ? stuck.data : []).filter(x => x.status === 'publishing')]) {
    if (await publishDue({ ...ctx, co: p.company_id }, p, tokens, now)) done++;
  }
  return done;
}
