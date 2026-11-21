// The WhatsApp Business adapter of Hoven's MCP server (docs/PRD.md §3.10): one approved template to one number, through
// the Cloud API. Used by the journeys tab; the token never leaves the server.
export async function sendTemplate(t: { token: string; phoneId: string }, to: string, template: { name: string; lang: string; name_param?: string }, f: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  const r = await f(`https://graph.facebook.com/v23.0/${t.phoneId}/messages`, {
    method: 'POST', headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template',
      template: { name: template.name, language: { code: template.lang },
        ...(template.name_param ? { components: [{ type: 'body', parameters: [{ type: 'text', text: template.name_param }] }] } : {}) } }),
  });
  const j = (await r.json().catch(() => ({}))) as { messages?: unknown[]; error?: { message?: string } };
  return j.messages ? { ok: true } : { ok: false, error: j.error?.message || 'ما انرسلت' };
}
