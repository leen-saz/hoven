// Hoven's MCP server on the Worker (docs/PRD.md §3.10): the endpoint, OAuth and discovery. Mounted before the pages.
import { Hono } from 'hono';
import type { AuthEnv } from '../lib/auth';
import { mcp as endpoint } from './server';
import { authorize, register, token, revoke, protectedResource, authServer, CORS } from './oauth';
import type { McpEnv } from './core';

export const mcp = new Hono<{ Bindings: AuthEnv & McpEnv }>();
const meta = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300', ...CORS } });
const pre = () => new Response(null, { status: 204, headers: CORS });

mcp.all('/mcp', c => endpoint(c.req.raw, c.env));
mcp.get('/.well-known/oauth-protected-resource', c => meta(protectedResource(new URL(c.req.url).origin)));
mcp.get('/.well-known/oauth-protected-resource/mcp', c => meta(protectedResource(new URL(c.req.url).origin)));
mcp.get('/.well-known/oauth-authorization-server', c => meta(authServer(new URL(c.req.url).origin)));
mcp.get('/.well-known/oauth-authorization-server/mcp', c => meta(authServer(new URL(c.req.url).origin)));
mcp.on(['GET', 'POST'], '/oauth/authorize', c => authorize(c.req.raw, c.env));
mcp.post('/oauth/register', c => register(c.req.raw, c.env));
mcp.post('/oauth/token', c => token(c.req.raw, c.env));
mcp.post('/oauth/revoke', c => revoke(c.req.raw, c.env));
mcp.on('OPTIONS', ['/oauth/register', '/oauth/token', '/oauth/revoke', '/.well-known/*'], pre);
