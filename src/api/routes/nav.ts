// /api/nav/counts: what waits for a decision, for the numbers next to the sidebar entries (docs/PRD.md §3.1). Each count
// only when this user may open its page; capped at 99 (the sidebar shows "99+"). Cheap reads: ids only, limit 100.
import { sb, json, handle, requireUser, can } from '../../lib/auth';
import { scoped, HOVEN_COMPANY } from '../../lib/tenant';

const CAP = 99;
const count = (d: unknown) => (Array.isArray(d) ? Math.min(d.length, CAP + 1) : 0);

export const counts = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any');
    const out: Record<string, number> = {};
    const jobs: Promise<void>[] = [];
    // Decision board: open suggestions (Hoven's alone, as on /api/today/state)
    if (user.co === HOVEN_COMPANY && can(user, 'control', cfg)) jobs.push(sb(cfg, '/rest/v1/suggestions?select=id&status=eq.open&limit=100', { admin: true })
      .then(r => { if (r.ok) out['control'] = count(r.data); }));
    // Social: posts scheduled and not yet approved
    if (can(user, 'social', cfg)) jobs.push(sb(cfg, scoped('/rest/v1/social_posts?select=id&status=eq.scheduled&approved_at=is.null&limit=100', user.co), { admin: true })
      .then(r => { if (r.ok) out['social'] = count(r.data); }));
    // Dream: campaigns being drafted (parts waiting for «اعتمد»)
    if (can(user, 'dream', cfg)) jobs.push(sb(cfg, scoped('/rest/v1/dream_projects?select=id&status=eq.drafting&limit=100', user.co), { admin: true })
      .then(r => { if (r.ok) out['dream'] = count(r.data); }));
    // Connections: accounts down after the hour's grace (src/lib/account-health.ts)
    if (user.co === HOVEN_COMPANY && can(user, 'connectors', cfg)) jobs.push(sb(cfg, `/rest/v1/connection_health?select=platform&company_id=eq.${HOVEN_COMPANY}&health=eq.down&limit=100`, { admin: true })
      .then(r => { if (r.ok) out['connectors'] = count(r.data); }));
    await Promise.all(jobs);
    return json(200, out);
  }),
};
