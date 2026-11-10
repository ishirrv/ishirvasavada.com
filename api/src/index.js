// API for ishirvasavada.com: the site assistant (/chat), visit stats (/v, /e) and a private dashboard (/admin).
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, ACTIONS, ANSWER_SCHEMA } from './knowledge.js';
import { renderAdmin } from './admin.js';

const ORIGINS = new Set(['https://ishirvasavada.com', 'https://www.ishirvasavada.com']);
const LIMITS = { perHour: 20, perDay: 400, qChars: 600, turns: 10, bodyBytes: 80_000 };
const EVENTS = new Set(['demo', 'resume', 'email', 'linkedin', 'chat', 'leave']);
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|monitor|curl|wget|python|node-fetch/i;

const MSG = {
  limit: "That's a lot of questions for one hour. Please email Ishir directly at ishirv00@gmail.com.",
  offline: "The assistant is offline right now. Please email Ishir at ishirv00@gmail.com.",
  busy: "The assistant is busy right now. Please try again in a minute.",
  refusal: "I can't help with that one. Ask me about Ishir's products, experience or how he builds with AI.",
  turns: "This conversation is getting long. Start a new one, or email Ishir at ishirv00@gmail.com.",
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = ORIGINS.has(origin) || (env.DEV_ORIGIN && origin === env.DEV_ORIGIN);
    const cors = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    try {
      if (req.method === 'POST' && url.pathname === '/chat') {
        if (!allowed) return json({ error: 'origin' }, 403);
        return json(await chat(req, env, ctx), 200, cors);
      }
      if (req.method === 'POST' && (url.pathname === '/v' || url.pathname === '/e')) {
        if (allowed && !BOT.test(req.headers.get('User-Agent') || '')) {
          const d = await readJson(req); // read the body before responding
          if (d) ctx.waitUntil(track(url.pathname, d, req, env).catch(e => console.error('track', e)));
        }
        return new Response(null, { status: 204, headers: cors });
      }
      if (req.method === 'GET' && url.pathname === '/admin') return admin(url, env);
      if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true, chat: Boolean(env.ANTHROPIC_API_KEY) }, 200, cors);
      return new Response('Not found', { status: 404 });
    } catch (e) {
      console.error(e);
      return json({ error: 'server' }, 500, cors);
    }
  },
};

/* ───── chat ───── */
async function chat(req, env, ctx) {
  const body = await readJson(req);
  const sid = clean(body?.sid, 40);
  const messages = validMessages(body?.messages);
  if (!messages) return { answer: MSG.busy, actions: [] };
  if (messages.filter(m => m.role === 'user').length > LIMITS.turns) return { answer: MSG.turns, actions: ['email'], reset: true };
  const q = messages[messages.length - 1].content;

  const iph = await ipHash(req, env);
  const now = Date.now(), hour = Math.floor(now / 3_600_000);
  const [perIp, perDay] = await Promise.all([
    bump(env, `h:${iph}:${hour}`, (hour + 1) * 3_600_000),
    bump(env, `d:${new Date(now).toISOString().slice(0, 10)}`, now + 2 * 86_400_000),
  ]);
  if (perIp > LIMITS.perHour || perDay > LIMITS.perDay) return { answer: MSG.limit, actions: ['email'] };
  if (!env.ANTHROPIC_API_KEY) return { answer: MSG.offline, actions: ['email'] };

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: 45_000 });
  const t0 = Date.now();
  let res;
  try {
    res = await client.beta.messages.create({
      model: env.MODEL || 'claude-opus-5-5',
      max_tokens: 2048, // cost cap for a public endpoint; answers are ~120 words
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // a declined request is retried server-side on Anthropic's recommended model
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages,
    });
  } catch (e) {
    let answer = MSG.busy;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) answer = MSG.offline;
    else if (e instanceof Anthropic.BadRequestError) console.error('bad request', e.message);
    else if (e instanceof Anthropic.RateLimitError) console.error('rate limited');
    else if (e instanceof Anthropic.APIError) console.error('api error', e.status, e.message);
    else console.error('chat error', e);
    ctx.waitUntil(logChat(env, req, sid, q, `[error] ${e?.status ?? ''} ${e?.message ?? e}`.slice(0, 300), null, Date.now() - t0, 0));
    return { answer, actions: answer === MSG.offline ? ['email'] : [] };
  }

  // Text after the last fallback boundary is the final model's answer.
  const fb = res.content.map(b => b.type).lastIndexOf('fallback');
  const text = res.content.filter((b, i) => i > fb && b.type === 'text').map(b => b.text).join('');
  let parsed = null;
  if (res.stop_reason !== 'refusal') { try { parsed = JSON.parse(text); } catch { /* truncated or malformed */ } }
  const answer = typeof parsed?.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : MSG.refusal;
  const actions = [...new Set((Array.isArray(parsed?.actions) ? parsed.actions : []).filter(a => ACTIONS.includes(a)))].slice(0, 2);

  ctx.waitUntil(logChat(env, req, sid, q, answer, res.usage, Date.now() - t0, parsed ? 1 : 0));
  // The client sends this turn back unchanged next time. Before a fallback boundary, keep only text and the boundary itself.
  const turn = res.content.filter((b, i) => i >= fb || b.type === 'text' || b.type === 'fallback');
  return { answer, actions, turn };
}

function validMessages(m) {
  if (!Array.isArray(m) || m.length === 0 || m.length > LIMITS.turns * 2 + 1) return null;
  const out = [];
  for (let i = 0; i < m.length; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const x = m[i];
    if (!x || x.role !== role) return null;
    if (role === 'user') {
      if (typeof x.content !== 'string') return null;
      const c = x.content.trim().slice(0, LIMITS.qChars);
      if (!c) return null;
      out.push({ role, content: c });
    } else {
      if (!Array.isArray(x.content) || x.content.length === 0 || x.content.length > 16) return null;
      if (!x.content.every(b => b && typeof b === 'object' && ['text', 'thinking', 'redacted_thinking', 'fallback'].includes(b.type))) return null;
      out.push({ role, content: x.content });
    }
  }
  return out[out.length - 1].role === 'user' ? out : null;
}

async function logChat(env, req, sid, q, a, usage, ms, ok) {
  const cf = req.cf || {};
  await env.DB.prepare('INSERT INTO chats (ts, sid, q, a, country, region, city, org, in_tok, out_tok, cache_read, ms, ok) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(new Date().toISOString(), sid, q, a, cf.country || null, cf.region || null, cf.city || null, cf.asOrganization || null,
      usage ? (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) : null, usage?.output_tokens ?? null, usage?.cache_read_input_tokens ?? null, ms, ok)
    .run();
}

/* ───── visit stats ───── */
async function track(path, d, req, env) {
  const cf = req.cf || {};
  const ts = new Date().toISOString(), sid = clean(d.sid, 40);
  if (!sid) return;
  if (path === '/v') {
    const ua = req.headers.get('User-Agent') || '';
    await env.DB.prepare('INSERT INTO visits (ts, sid, path, ref, referrer, country, region, city, org, asn, device, w, iph) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(ts, sid, clean(d.path, 120), clean(d.ref, 60), referrerHost(d.referrer), cf.country || null, cf.region || null, cf.city || null,
        cf.asOrganization || null, cf.asn || null, device(ua), Number.isFinite(d.w) ? Math.round(d.w) : null, await ipHash(req, env))
      .run();
  } else {
    const type = clean(d.type, 20);
    if (!EVENTS.has(type)) return;
    await env.DB.prepare('INSERT INTO events (ts, sid, type, detail) VALUES (?,?,?,?)').bind(ts, sid, type, clean(d.detail, 80)).run();
  }
}

function referrerHost(r) {
  if (typeof r !== 'string' || !r) return null;
  try { const h = new URL(r).hostname.replace(/^www\./, ''); return h.endsWith('ishirvasavada.com') ? null : h.slice(0, 80); } catch { return null; }
}

function device(ua) {
  const kind = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'Phone' : 'Desktop';
  const os = /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|CrOS/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [kind, os, br].filter(Boolean).join(' · ');
}

/* ───── dashboard ───── */
async function admin(url, env) {
  const key = url.searchParams.get('key') || '';
  if (!env.ADMIN_KEY || !(await same(key, env.ADMIN_KEY))) return new Response('Not found', { status: 404 });
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [visits, events, chats, seen] = await Promise.all([
    env.DB.prepare('SELECT * FROM visits WHERE ts >= ? ORDER BY ts DESC LIMIT 2000').bind(since).all(),
    env.DB.prepare('SELECT * FROM events WHERE ts >= ? ORDER BY ts LIMIT 10000').bind(since).all(),
    env.DB.prepare('SELECT * FROM chats WHERE ts >= ? ORDER BY ts DESC LIMIT 500').bind(since).all(),
    env.DB.prepare('SELECT iph, MIN(ts) AS first FROM visits GROUP BY iph').all(),
  ]);
  const html = renderAdmin({ key, days, visits: visits.results, events: events.results, chats: chats.results, firstSeen: Object.fromEntries(seen.results.map(r => [r.iph, r.first])) });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' } });
}

/* ───── helpers ───── */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

async function readJson(req) {
  const t = await req.text();
  if (t.length > LIMITS.bodyBytes) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function clean(v, n) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;
}

// Rate-limit counters. Visitors' IPs are never stored, only a salted hash.
async function bump(env, k, exp) {
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM limits WHERE exp < ?').bind(Date.now()).run();
  const r = await env.DB.prepare('INSERT INTO limits (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n').bind(k, exp).first();
  return r?.n ?? 1;
}

async function ipHash(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SALT || ''}|${ip}`));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
