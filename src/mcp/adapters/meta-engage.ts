// The Meta engagement adapter of Hoven's MCP server (docs/PRD.md §3.10): comments on the page's and Instagram's posts,
// private messages (Messenger and Instagram Direct), and the replies to them. Reads are light (the latest posts and
// conversations only); a reply is one call. Tokens stay on the server; only the platform's ids and text come back.
const GRAPH = 'https://graph.facebook.com/v23.0/';
type Fetch = typeof fetch;

export interface Tokens { pageToken: string; pageId: string; igId?: string }
export interface Item {
  platform: 'facebook' | 'instagram'; kind: 'comment' | 'dm';
  external_id: string;           // the comment id, or the message id
  thread_id: string;             // the post id (comments) or the conversation id (messages)
  author_id: string | null; author: string | null;
  text: string; at: string;
  post_text?: string | null;     // what the comment is under, for the model's context
}

async function get(f: Fetch, path: string, fields: string, token: string): Promise<Record<string, unknown>> {
  const sep = path.includes('?') ? '&' : '?';
  const r = await f(`${GRAPH}${path}${sep}fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`);
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j['error']) {
    const e = (j['error'] || {}) as { message?: string; code?: number };
    throw Object.assign(new Error(String(e.message || `Meta ${r.status}`).slice(0, 300)), { code: e.code, status: r.status });
  }
  return j;
}
async function post(f: Fetch, path: string, body: Record<string, unknown>, token: string): Promise<Record<string, unknown>> {
  const form = new URLSearchParams({ access_token: token });
  for (const [k, v] of Object.entries(body)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  const r = await f(GRAPH + path, { method: 'POST', body: form });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j['error']) {
    const e = (j['error'] || {}) as { message?: string; error_user_msg?: string; code?: number };
    throw Object.assign(new Error(String(e.error_user_msg || e.message || `Meta ${r.status}`).slice(0, 300)), { code: e.code, status: r.status });
  }
  return j;
}
const list = (j: Record<string, unknown>, k = 'data') => ((j[k] as { data?: unknown[] } | undefined)?.data ?? (Array.isArray(j[k]) ? j[k] : [])) as Record<string, unknown>[];

/** Comments on the page's latest posts and the Instagram account's latest media (not the page's own). */
export async function comments(t: Tokens, f: Fetch = fetch): Promise<Item[]> {
  const out: Item[] = [];
  const fb = await get(f, `${t.pageId}/feed?limit=10`, 'id,message,comments.limit(25).order(reverse_chronological){id,from,message,created_time}', t.pageToken);
  for (const p of list(fb)) for (const c of list(p, 'comments')) {
    const from = (c['from'] || {}) as { id?: string; name?: string };
    if (from.id === t.pageId || !c['message']) continue;
    out.push({ platform: 'facebook', kind: 'comment', external_id: String(c['id']), thread_id: String(p['id']), author_id: from.id ?? null, author: from.name ?? null,
      text: String(c['message']), at: String(c['created_time'] || ''), post_text: String(p['message'] || '').slice(0, 300) || null });
  }
  if (t.igId) {
    const ig = await get(f, `${t.igId}/media?limit=10`, 'id,caption,comments.limit(25){id,text,username,timestamp,from}', t.pageToken);
    for (const m of list(ig)) for (const c of list(m, 'comments')) {
      const from = (c['from'] || {}) as { id?: string; username?: string };
      if (from.id === t.igId || !c['text']) continue;
      out.push({ platform: 'instagram', kind: 'comment', external_id: String(c['id']), thread_id: String(m['id']), author_id: from.id ?? null, author: String(c['username'] || from.username || '') || null,
        text: String(c['text']), at: String(c['timestamp'] || ''), post_text: String(m['caption'] || '').slice(0, 300) || null });
    }
  }
  return out;
}

/** The newest customer message of each recent conversation (Messenger, and Instagram Direct when linked). */
export async function messages(t: Tokens, f: Fetch = fetch): Promise<Item[]> {
  const out: Item[] = [];
  for (const platform of (t.igId ? ['messenger', 'instagram'] : ['messenger']) as ('messenger' | 'instagram')[]) {
    const j = await get(f, `${t.pageId}/conversations?platform=${platform}&limit=15`, 'id,updated_time,messages.limit(3){id,message,from,created_time}', t.pageToken);
    for (const c of list(j)) {
      const own = new Set([t.pageId, t.igId].filter(Boolean));
      const m = list(c, 'messages').find(x => !own.has(String(((x['from'] || {}) as { id?: string }).id || '')) && x['message']);
      if (!m) continue;
      const from = (m['from'] || {}) as { id?: string; name?: string; username?: string };
      out.push({ platform: platform === 'messenger' ? 'facebook' : 'instagram', kind: 'dm', external_id: String(m['id']), thread_id: String(c['id']),
        author_id: from.id ?? null, author: from.name || from.username || null, text: String(m['message']), at: String(m['created_time'] || '') });
    }
  }
  return out;
}

/** Reply under a comment (public). */
export async function replyComment(t: Tokens, platform: 'facebook' | 'instagram', commentId: string, text: string, f: Fetch = fetch): Promise<string> {
  const j = platform === 'instagram' ? await post(f, `${commentId}/replies`, { message: text }, t.pageToken) : await post(f, `${commentId}/comments`, { message: text }, t.pageToken);
  return String(j['id'] || '');
}

/** Answer a private message (within Meta's 24-hour window, messaging_type RESPONSE). */
export async function replyMessage(t: Tokens, recipientId: string, text: string, f: Fetch = fetch): Promise<string> {
  const j = await post(f, `${t.pageId}/messages`, { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text } }, t.pageToken);
  return String(j['message_id'] || '');
}

/** The page tokens from the vault, or null when the page is not connected. */
export function engageTokens(v: Record<string, string>): Tokens | null {
  if (!v['META_PAGE_ACCESS_TOKEN'] || !v['META_PAGE_ID']) return null;
  return { pageToken: v['META_PAGE_ACCESS_TOKEN'], pageId: v['META_PAGE_ID'], ...(v['IG_USER_ID'] ? { igId: v['IG_USER_ID'] } : {}) };
}
