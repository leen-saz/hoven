// Ad tools of Hoven's MCP server. Meta today; other platforms answer «قريباً» until their adapter exists.
// The rules of docs/PRD.md §6.3 run here, inside the server, whoever calls: Leen's approval (the owner), new campaigns
// paused, a budget never more than 20% above where the day started, changes on managed campaigns only, the kill switch.
import { checkWrite, checkBudget } from '../../lib/ads-write/guard';
import { sb } from '../../lib/auth';
import { cleanGoals, cleanManaged, isManaged, type Fam } from '../../modules/buyer/engine';
import { ownFile } from '../../modules/dream/dream';
import { createPaused, setStatus, metaConfig, getCampaign, listCampaigns, setBudget, type Done, type Plan, type MetaConfig } from '../adapters/meta';
import { register, ToolError, vault, killOn, buyerSettings, change, startOfDay, type Ctx } from '../core';

export const ADAPTERS: Fam[] = ['meta'];
const PLATFORM = { type: 'string', enum: ['meta', 'snap', 'tiktok', 'google'], description: 'المنصة' };

async function meta(ctx: Ctx, platform: unknown): Promise<MetaConfig> {
  if (platform !== 'meta') throw new ToolError(501, ADAPTERS.includes(platform as Fam) ? 'المنصة مو مدعومة' : 'الكتابة على هالمنصة تجي لاحقاً');
  const mc = metaConfig(await vault(ctx.cfg, ctx.co));
  if (!mc.cfg) throw new ToolError(503, `ناقص في صفحة الربط: ${mc.missing.join('، ')}`);
  return mc.cfg;
}
const id = (x: unknown) => { const s = String(x ?? '').trim(); if (!/^[A-Za-z0-9_]{1,40}$/.test(s)) throw new ToolError(400, 'رقم الحملة مو صحيح'); return s; };
// The approver for every write: Leen (the owner) until she names another one or switches an agent to «تلقائي»
const approver = (ctx: Ctx) => ctx.owner;
// A Dream launch the change belongs to (in-process callers), recorded in ad_changes
const launchOf = (i: Record<string, unknown>) => (Number.isInteger(i['launch_id']) ? i['launch_id'] : null);
const stop = (msg: string | null) => { if (msg) throw new ToolError(403, msg); };

async function managedFor(ctx: Ctx, platform: Fam, name: string): Promise<boolean> {
  const st = await buyerSettings(ctx.cfg, ctx.co);
  return isManaged(cleanManaged(st['managed']), { fam: platform, campaign: name });
}

register(
  {
    name: 'ads.list_campaigns', title: 'حملات الحساب', write: false,
    description: 'List the ad account\'s campaigns on a platform: id, name, status, campaign daily budget (SAR), and whether Hoven may change it (managed).',
    input: { type: 'object', properties: { platform: PLATFORM }, required: ['platform'] },
    run: async (ctx, i) => {
      const cfg = await meta(ctx, i['platform']);
      const st = await buyerSettings(ctx.cfg, ctx.co), list = cleanManaged(st['managed']);
      return { campaigns: (await listCampaigns(cfg, ctx.f)).map(c => ({ ...c, managed: isManaged(list, { fam: 'meta', campaign: c.name }) })) };
    },
  },
  {
    name: 'ads.get_campaign', title: 'حملة وحدة', write: false,
    description: 'One campaign: name, status, effective status, daily budget (SAR) and where the budget lives (campaign or its single ad set).',
    input: { type: 'object', properties: { platform: PLATFORM, campaign_id: { type: 'string' } }, required: ['platform', 'campaign_id'] },
    run: async (ctx, i) => getCampaign(await meta(ctx, i['platform']), id(i['campaign_id']), ctx.f),
  },
  {
    name: 'ads.create_campaign', title: 'إنشاء حملة موقوفة', write: true, money: true,
    description: 'Create a campaign PAUSED with one ad set and one ad per design. Nothing delivers until ads.set_status ACTIVE. Resumable: pass back `done` from a failed attempt.',
    input: { type: 'object', required: ['platform', 'plan'], properties: {
      platform: PLATFORM,
      plan: { type: 'object', description: '{ name, daily (SAR), link, targeting: { ageMin, ageMax, genders }, ads: [{ headline, body, cta, image_key }] }' },
      typed_daily: { type: 'number', description: 'Leen typed this daily budget herself (above her plan)' },
      done: { type: 'object', description: 'What a failed attempt already created' },
      launch_id: { type: 'integer', description: 'Dream launch this belongs to' },
    } },
    run: async (ctx, i) => {
      stop(checkWrite('create_paused', { kill: await killOn(ctx.cfg), owner: approver(ctx), managed: true }));
      const cfg = await meta(ctx, i['platform']);
      const plan = i['plan'] as Plan;
      if (!plan || typeof plan !== 'object' || !Array.isArray(plan.ads) || !plan.ads.length) throw new ToolError(400, 'الخطة ناقصة: اسم وميزانية ورابط وإعلان واحد على الأقل');
      if (!/^https:\/\//.test(String(plan.link || ''))) throw new ToolError(400, 'الرابط لازم يبدأ بـ https://');
      for (const a of plan.ads) if (!ownFile(ctx.co, a.image_key)) throw new ToolError(400, 'صورة إعلان مو من ملفات شركتك');
      const goals = cleanGoals((await buyerSettings(ctx.cfg, ctx.co))['goals']);
      const typed = Number(i['typed_daily']);
      stop(checkBudget({ planned: goals.meta?.dailyBudget ?? null, typed: Number.isFinite(typed) && typed > 0 ? typed : null, next: Number(plan.daily) }));
      const getFile = async (key: string) => {
        if (!ownFile(ctx.co, key) || !ctx.env.FILES) return null;
        const o = await ctx.env.FILES.get(key);
        return o ? { bytes: await o.arrayBuffer(), type: o.httpMetadata?.contentType || 'image/jpeg' } : null;
      };
      let last: Done = (i['done'] as Done) || {};
      try {
        const d = await createPaused(cfg, plan, last, getFile, async x => { last = x; await ctx.onProgress?.(x); }, ctx.f);
        await change(ctx, { platform: 'meta', level: 'campaign', target_id: d.campaign_id, launch_id: launchOf(i), action: 'create_paused', after: { name: plan.name, daily_sar: plan.daily, ads: Object.keys(d.ads || {}).length, status: 'PAUSED' } });
        // The new campaign joins the managed list: the only campaigns a write may change later
        const st = await buyerSettings(ctx.cfg, ctx.co);
        const managed = cleanManaged([...(Array.isArray(st['managed']) ? st['managed'] as unknown[] : []), { platform: 'meta', campaign: plan.name }]);
        await sb(ctx.cfg, '/rest/v1/buyer_settings?on_conflict=company_id', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates' },
          body: { company_id: ctx.co, managed, updated_by: ctx.by, updated_at: new Date().toISOString() } });
        return { campaign_id: d.campaign_id, done: d, ads: Object.keys(d.ads || {}).length, status: 'PAUSED' };
      } catch (err) {
        if (err instanceof ToolError) throw err;
        const msg = String((err as Error).message).slice(0, 400);
        await change(ctx, { platform: 'meta', level: 'campaign', target_id: last.campaign_id ?? null, launch_id: launchOf(i), action: 'create_paused', ok: false, error: msg });
        throw new ToolError(502, msg, { done: last });
      }
    },
  },
  {
    name: 'ads.set_status', title: 'تشغيل أو إيقاف حملة', write: true, money: true,
    description: 'Switch a campaign ACTIVE or PAUSED, then read back what the platform says. Pausing is always allowed; switching on needs a managed campaign and the kill switch off.',
    input: { type: 'object', required: ['platform', 'campaign_id', 'status'], properties: { platform: PLATFORM, campaign_id: { type: 'string' }, status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] }, launch_id: { type: 'integer' } } },
    run: async (ctx, i) => {
      const on = i['status'] === 'ACTIVE';
      if (!on && i['status'] !== 'PAUSED') throw new ToolError(400, 'الحالة ACTIVE أو PAUSED');
      const cfg = await meta(ctx, i['platform']);
      const cid = id(i['campaign_id']);
      const before = await getCampaign(cfg, cid, ctx.f);
      stop(checkWrite(on ? 'activate' : 'pause', { kill: await killOn(ctx.cfg), owner: approver(ctx), managed: await managedFor(ctx, 'meta', before.name) }));
      try {
        const got = await setStatus(cfg, cid, on ? 'ACTIVE' : 'PAUSED', ctx.f);
        await change(ctx, { platform: 'meta', level: 'campaign', target_id: cid, launch_id: launchOf(i), action: on ? 'activate' : 'pause', before: { status: before.status }, after: got });
        return { campaign_id: cid, ...got };
      } catch (err) {
        const msg = String((err as Error).message).slice(0, 400);
        await change(ctx, { platform: 'meta', level: 'campaign', target_id: cid, launch_id: launchOf(i), action: on ? 'activate' : 'pause', ok: false, error: msg });
        throw new ToolError(502, msg);
      }
    },
  },
  {
    name: 'ads.set_budget', title: 'تغيير الميزانية اليومية', write: true, money: true,
    description: 'Set a managed campaign\'s daily budget (SAR). Never more than 20% above where the Riyadh day started; lowering is always within the limit.',
    input: { type: 'object', required: ['platform', 'campaign_id', 'daily'], properties: { platform: PLATFORM, campaign_id: { type: 'string' }, daily: { type: 'number', description: 'SAR per day' }, why: { type: 'string' } } },
    run: async (ctx, i) => {
      const cfg = await meta(ctx, i['platform']);
      const cid = id(i['campaign_id']);
      const c = await getCampaign(cfg, cid, ctx.f);
      stop(checkWrite('set_budget', { kill: await killOn(ctx.cfg), owner: approver(ctx), managed: await managedFor(ctx, 'meta', c.name) }));
      if (c.daily == null) throw new ToolError(409, 'هالحملة ميزانيتها موزعة على أكثر من مجموعة: غيّرها من مدير الإعلانات');
      const first = await startOfDay(ctx, 'meta', cid);
      const begin = Number((first?.['before'] as { daily?: number } | undefined)?.daily ?? c.daily);
      const next = Number(i['daily']);
      stop(checkBudget({ startOfDay: begin, next }));
      try {
        const got = await setBudget(cfg, c, next, ctx.f);
        await change(ctx, { platform: 'meta', level: c.level === 'adset' ? 'adset' : 'campaign', target_id: cid, action: 'set_budget', before: { daily: c.daily }, after: { daily: got.daily, why: String(i['why'] || '').slice(0, 300) } });
        return { campaign_id: cid, before: c.daily, daily: got.daily };
      } catch (err) {
        const msg = String((err as Error).message).slice(0, 400);
        await change(ctx, { platform: 'meta', level: 'campaign', target_id: cid, action: 'set_budget', ok: false, error: msg, before: { daily: c.daily } });
        throw new ToolError(502, msg);
      }
    },
  },
);
