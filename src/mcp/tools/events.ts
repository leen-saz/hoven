// Events and jobs of Hoven's MCP server (docs/PRD.md §3.10). Events: what happened that Leen should know (mcp_events).
// Jobs: the long actions (a social post Instagram is still preparing, a Dream launch) by their own rows, one shape.
import { sb } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { register, ToolError, rows } from '../core';

register(
  {
    name: 'events.list', title: 'آخر الأحداث', write: false,
    description: 'The latest outbound events (posts published or failed, accounts down or back, automatic changes), newest first. unseen=true for the ones Leen has not opened.',
    input: { type: 'object', properties: { unseen: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    run: async (ctx, i) => {
      const n = Math.min(100, Math.max(1, Number(i['limit']) || 30));
      const r = await sb(ctx.cfg, scoped(`/rest/v1/mcp_events?select=id,kind,tool,agent,data,seen,at${i['unseen'] ? '&seen=eq.false' : ''}&order=at.desc&limit=${n}`, ctx.co), { admin: true });
      if (!r.ok) throw new ToolError(503, 'جدول الأحداث مو جاهز (migration 037_mcp_events.sql)');
      return { events: rows(r.data) };
    },
  },
  {
    name: 'jobs.get', title: 'حالة عملية طويلة', write: false,
    description: 'The state of a long action: kind "social_post" (scheduled, publishing, published, partial, failed) or "dream_launch" (pending, created, failed, active, paused).',
    input: { type: 'object', required: ['kind', 'id'], properties: { kind: { type: 'string', enum: ['social_post', 'dream_launch'] }, id: { type: 'integer' } } },
    run: async (ctx, i) => {
      const id = Number(i['id']);
      if (!Number.isInteger(id) || id <= 0) throw new ToolError(400, 'الرقم مو صحيح');
      const q = i['kind'] === 'social_post' ? `/rest/v1/social_posts?id=eq.${id}&select=id,status,publish_at,claimed_at,results`
        : i['kind'] === 'dream_launch' ? `/rest/v1/dream_launches?id=eq.${id}&select=id,platform,status,error,updated_at,external`
        : null;
      if (!q) throw new ToolError(400, 'النوع social_post أو dream_launch');
      const row = rows((await sb(ctx.cfg, scoped(q, ctx.co), { admin: true })).data)[0];
      if (!row) throw new ToolError(404, 'ما لقيتها');
      const done = ['published', 'partial', 'failed', 'created', 'active', 'paused'].includes(String(row['status']));
      return { kind: i['kind'], id, status: row['status'], done, detail: row };
    },
  },
);
