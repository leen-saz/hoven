// /api/dream/*: the start page. This first step only says which parts are ready (keys present); the chat, the draft
// and the paused publish come next.
import { json, handle, requireUser } from '../../lib/auth';

type DreamEnv = { OPENAI_API_KEY?: string; GEMINI_API_KEY?: string };

export const state = { GET: handle(async (request, e: DreamEnv & Parameters<typeof requireUser>[1]) => {
  await requireUser(request, e, 'dream');
  return json(200, { chat: !!e.OPENAI_API_KEY, voice: !!e.GEMINI_API_KEY });
}) };
