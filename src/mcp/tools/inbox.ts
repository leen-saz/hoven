// Social replies through Hoven's MCP server (Leen, 2026-11-21): Grok on OpenRouter reads new comments and private
// messages, sorts them and drafts a reply; nothing is sent until an approver presses «أرسل» («بموافقتي»).
//  - inbox.sync (the cron, every 15 minutes): fetch, store once, draft; delete private messages older than 90 days.
//  - inbox.list: what waits (drafted, escalated) and what was done.
//  - inbox.reply: send the approved text (Leen or a named social approver). A private message only within 24 hours.
//  - inbox.ignore: close one without a reply.
import { sb } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { generate, pick } from '../../lib/llm';
import { usageCtx } from '../../lib/usage';
import { knowledgeFor, rulesFor, withKnowledge } from '../../modules/knowledge/knowledge';
import { canApprove, cleanApprovers } from '../../modules/social/social';
import { replyPrompt, parseReply, statusFor, inWindow, finalText, dmCutoff } from '../../modules/social/inbox';
import { comments, messages, replyComment, replyMessage, engageTokens, type Item } from '../adapters/meta-engage';
import { register, ToolError, vault, rows, event, type Ctx } from '../core';

type Row = Record<string, unknown>;
const SEL = 'id,platform,kind,external_id,thread_id,author_id,author,text,post_text,at,category,status,draft,reply_id,error,decided_by,decided_at';
const MAX_DRAFTS = 20;   // per run: a burst of comments never runs up the model bill in one go

async function approver(ctx: Ctx): Promise<boolean> {
  if (ctx.owner) return true;
  const r = await sb(ctx.cfg, `/rest/v1/companies?id=eq.${ctx.co}&select=social_approvers`, { admin: true });
  return canApprove(ctx.by, cleanApprovers(rows(r.data)[0]?.['social_approvers']), false);
}

/** Fetch new comments and messages, store each once, and draft replies with Grok. Returns what was added and drafted. */
export async function sync(ctx: Ctx, now = Date.now()): Promise<{ added: number; drafted: number; escalated: number; deleted: number; skipped?: string }> {
  // PDPL: private messages go after 90 days, whatever else happens in this run
  const del = await sb(ctx.cfg, scoped(`/rest/v1/social_inbox?kind=eq.dm&at=lt.${dmCutoff(now)}`, ctx.co), { method: 'DELETE', admin: true, headers: { Prefer: 'return=representation' } });
  const deleted = rows(del.data).length;
  const t = engageTokens(await vault(ctx.cfg, ctx.co));
  if (!t) return { added: 0, drafted: 0, escalated: 0, deleted, skipped: 'page_not_connected' };
  let got: Item[] = [];
  try { got = [...await comments(t, ctx.f), ...await messages(t, ctx.f)]; }
  catch (err) { throw new ToolError(502, `ميتا ما رجّع التعليقات: ${String((err as Error).message).slice(0, 200)}`); }
  const fresh = got.filter(i => i.at && Date.parse(i.at) > now - 7 * 864e5 && (i.kind === 'comment' || Date.parse(i.at) > Date.parse(dmCutoff(now))));
  let added = 0;
  if (fresh.length) {
    const w = await sb(ctx.cfg, '/rest/v1/social_inbox?on_conflict=company_id,platform,external_id', { method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: fresh.map(i => ({ company_id: ctx.co, platform: i.platform, kind: i.kind, external_id: i.external_id, thread_id: i.thread_id, author_id: i.author_id, author: i.author?.slice(0, 80) ?? null,
        text: i.text.slice(0, 4000), post_text: i.post_text ?? null, at: i.at, status: 'new' })) });
    if (!w.ok) throw new ToolError(503, 'جدول الردود مو جاهز (migration 039_social_inbox.sql)');
    added = rows(w.data).length;
  }
  // Draft what is new, oldest first, a few per run
  const env = ctx.env as Parameters<typeof generate>[0];
  if (!pick(env, 'social')) return { added, drafted: 0, escalated: 0, deleted, skipped: 'no_model' };
  const todo = rows<Row>((await sb(ctx.cfg, scoped(`/rest/v1/social_inbox?status=eq.new&select=${SEL}&order=at.asc&limit=${MAX_DRAFTS}`, ctx.co), { admin: true })).data);
  const knowledge = todo.length ? await knowledgeFor(ctx.cfg, ctx.co, 'social') : '';
  let drafted = 0, escalated = 0;
  for (const m of todo) {
    let out;
    try { out = await generate(env, 'social', { messages: withKnowledge([{ role: 'user', content: replyPrompt({ platform: m['platform'] as 'facebook', kind: m['kind'] as 'comment', author: m['author'] as string | null, text: String(m['text']), post_text: m['post_text'] as string | null }) }], knowledge), max_tokens: 500 }, ctx.f, usageCtx(ctx.cfg, { co: ctx.co })); }
    catch { break; }   // the model is down or the month's cap is reached: the rest waits for the next run
    const p = parseReply(out.response, m['kind'] as 'comment' | 'dm');
    const status = statusFor(p.category, p.draft);
    await sb(ctx.cfg, `/rest/v1/social_inbox?id=eq.${m['id']}`, { method: 'PATCH', admin: true, body: { category: p.category, draft: p.draft, status } });
    if (status === 'drafted') drafted++;
    if (status === 'escalated') { escalated++; await event(ctx, 'inbox.escalated', 'inbox.sync', { id: m['id'], platform: m['platform'], kind: m['kind'], category: p.category }); }
  }
  return { added, drafted, escalated, deleted };
}

register(
  {
    name: 'inbox.sync', title: 'اسحب التعليقات والرسائل', write: true,
    description: 'Fetch new comments and private messages from Facebook and Instagram, sort them and draft replies with Grok. Sends nothing.',
    input: { type: 'object', properties: {} },
    run: async ctx => sync(ctx),
  },
  {
    name: 'inbox.list', title: 'الردود', write: false,
    description: 'Comments and private messages with their category, Grok\'s draft and status (drafted = waits for approval, escalated = needs Leen).',
    input: { type: 'object', properties: { status: { type: 'string', enum: ['drafted', 'escalated', 'sent', 'ignored', 'failed', 'new', 'expired'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    run: async (ctx, i) => {
      const n = Math.min(100, Math.max(1, Number(i['limit']) || 50));
      const st = typeof i['status'] === 'string' && /^[a-z]+$/.test(i['status']) ? `&status=eq.${i['status']}` : '';
      const r = await sb(ctx.cfg, scoped(`/rest/v1/social_inbox?select=${SEL}${st}&order=at.desc&limit=${n}`, ctx.co), { admin: true });
      if (!r.ok) throw new ToolError(503, 'جدول الردود مو جاهز (migration 039_social_inbox.sql)');
      return { items: rows(r.data) };
    },
  },
  {
    name: 'inbox.reply', title: 'أرسل الرد', write: true,
    description: 'Send the reply to one comment or private message: the given text, else Grok\'s draft. Needs the approver. A private message can be answered within 24 hours only.',
    input: { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, text: { type: 'string' } } },
    run: async (ctx, i) => {
      if (!(await approver(ctx))) throw new ToolError(403, 'الرد يحتاج موافقة لين أو المعتمد');
      const m = rows<Row>((await sb(ctx.cfg, scoped(`/rest/v1/social_inbox?id=eq.${Number(i['id']) || 0}&select=${SEL}`, ctx.co), { admin: true })).data)[0];
      if (!m) throw new ToolError(404, 'الرسالة مو موجودة');
      if (m['status'] === 'sent') return { id: m['id'], status: 'sent', reply_id: m['reply_id'], already: true };
      const kind = m['kind'] as 'comment' | 'dm';
      if (kind === 'dm' && !inWindow(String(m['at']))) {
        await sb(ctx.cfg, `/rest/v1/social_inbox?id=eq.${m['id']}`, { method: 'PATCH', admin: true, body: { status: 'expired' } });
        throw new ToolError(409, 'مرت ٢٤ ساعة على الرسالة: ميتا ما تسمح بالرد عليها من هنا، رد من التطبيق');
      }
      const fin = finalText(kind, m['draft'] as string | null, i['text'], await rulesFor(ctx.cfg, ctx.co));
      if (!fin) throw new ToolError(400, 'اكتب الرد أول');
      const t = engageTokens(await vault(ctx.cfg, ctx.co));
      if (!t) throw new ToolError(503, 'صفحة فيسبوك مو مربوطة: اربطها من صفحة الربط');
      // Claim it first (one send, even with two clicks); a failed send may be tried again
      const claim = await sb(ctx.cfg, `/rest/v1/social_inbox?id=eq.${m['id']}&status=neq.sent`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { status: 'sent', decided_by: ctx.by, decided_at: new Date().toISOString() } });
      if (!rows(claim.data).length) throw new ToolError(409, 'انرسل الرد من قبل');
      try {
        const id = kind === 'dm' ? await replyMessage(t, String(m['author_id'] || ''), fin.text, ctx.f) : await replyComment(t, m['platform'] as 'facebook', String(m['external_id']), fin.text, ctx.f);
        await sb(ctx.cfg, `/rest/v1/social_inbox?id=eq.${m['id']}`, { method: 'PATCH', admin: true, body: { reply_id: id, draft: fin.text, error: null } });
        return { id: m['id'], status: 'sent', reply_id: id, notices: fin.notices };
      } catch (err) {
        const msg = String((err as Error).message).slice(0, 300);
        await sb(ctx.cfg, `/rest/v1/social_inbox?id=eq.${m['id']}`, { method: 'PATCH', admin: true, body: { status: 'failed', error: msg } });
        throw new ToolError(502, msg);
      }
    },
  },
  {
    name: 'inbox.ignore', title: 'تجاهل', write: true,
    description: 'Close one comment or private message without replying.',
    input: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    run: async (ctx, i) => {
      if (!(await approver(ctx))) throw new ToolError(403, 'يحتاج موافقة لين أو المعتمد');
      const r = await sb(ctx.cfg, scoped(`/rest/v1/social_inbox?id=eq.${Number(i['id']) || 0}&status=neq.sent`, ctx.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { status: 'ignored', decided_by: ctx.by, decided_at: new Date().toISOString() } });
      if (!rows(r.data).length) throw new ToolError(404, 'الرسالة مو موجودة أو انرد عليها');
      return { id: Number(i['id']), status: 'ignored' };
    },
  },
);
