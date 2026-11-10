// Private dashboard HTML. Everything is rendered on the server; the page has no scripts.
const DEMO = { rules: 'Rules engine', risk: 'Risk workflows', eco: 'Ecodrop', rec: 'Recognito', plan: 'Blueprint agent', jc: 'Cost-control crew' };
const ISP = /comcast|charter|spectrum|at&t|verizon|t-mobile|cox|frontier|centurylink|lumen|altice|optimum|mediacom|windstream|rcn|google fiber|starlink|vodafone|airtel|jio|bsnl|bt |virgin media|sky |telefonica|orange|deutsche telekom|rogers|bell canada|shaw|telus|cloudflare|amazon|digitalocean|microsoft|oracle|akamai|fastly|ovh|hetzner|linode|apple inc|icloud|private relay/i;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = ts => new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const place = r => [r.city, r.region, r.country].filter(Boolean).join(', ') || 'Unknown';
const dur = s => !s ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
const top = (rows, f, n = 6) => {
  const m = new Map();
  for (const r of rows) { const k = f(r); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
};

export function renderAdmin({ key, days, visits, events, chats, firstSeen }) {
  const k = encodeURIComponent(key);
  // one row per session (sid), using its first page view
  const sessions = new Map();
  for (const v of [...visits].reverse()) if (!sessions.has(v.sid)) sessions.set(v.sid, { ...v, ev: [], qs: 0, secs: 0 });
  for (const e of events) {
    const s = sessions.get(e.sid); if (!s) continue;
    if (e.type === 'leave') s.secs = Math.max(s.secs, parseInt(e.detail, 10) || 0); else s.ev.push(e);
  }
  for (const c of chats) { const s = sessions.get(c.sid); if (s) s.qs++; }
  const list = [...sessions.values()].sort((a, b) => b.ts.localeCompare(a.ts));

  const evCount = t => events.filter(e => e.type === t).length;
  const returning = list.filter(s => firstSeen[s.iph] && firstSeen[s.iph] < s.ts).length;
  const source = s => [s.ref && `tag: ${s.ref}`, s.referrer].filter(Boolean).join(' · ') || 'Direct';
  const company = s => s.org && !ISP.test(s.org) ? s.org : null;

  const activity = s => {
    const out = [];
    const demos = [...new Set(s.ev.filter(e => e.type === 'demo').map(e => DEMO[e.detail] || e.detail))];
    if (demos.length) out.push(`Opened ${demos.join(', ')}`);
    for (const [t, label] of [['resume', 'Resume'], ['email', 'Copied email'], ['linkedin', 'LinkedIn']]) if (s.ev.some(e => e.type === t)) out.push(label);
    if (s.qs) out.push(`Asked ${s.qs} question${s.qs > 1 ? 's' : ''}`);
    return out.map(x => `<span class="chip">${esc(x)}</span>`).join(' ') || '<span class="mute">Browsed</span>';
  };

  const card = (n, l) => `<div class="card"><b>${n}</b><span>${l}</span></div>`;
  const tops = (title, rows) => `<div class="top"><h3>${title}</h3>${rows.length ? `<ol>${rows.map(([k, n]) => `<li><span>${esc(k)}</span><b>${n}</b></li>`).join('')}</ol>` : '<p class="mute">Nothing yet</p>'}</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Site visitors</title>
<style>
:root{--bg:#F4F5F2;--panel:#fff;--ink:#14181F;--ink2:#4C5560;--ink3:#7B8490;--rule:#DDE0DA;--acc:#1D3FD8;--chip:#EEF1FB}
@media (prefers-color-scheme:dark){:root{--bg:#0B1019;--panel:#111826;--ink:#E6EAF1;--ink2:#A2ABBA;--ink3:#7D879A;--rule:#243045;--acc:#8EA2FF;--chip:#1B2440}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:28px 20px 60px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:32px 0 10px}h3{font-size:13px;margin:0 0 8px;color:var(--ink2);font-weight:600}
.sub{color:var(--ink2);margin:4px 0 0}.mute{color:var(--ink3)}a{color:var(--acc)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:20px}
.card{background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column}.card b{font-size:24px}.card span{color:var(--ink2);font-size:13px}
.tops{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px}
.top{background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:14px 16px}.top ol{list-style:none;margin:0;padding:0}.top li{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-top:1px solid var(--rule)}.top li:first-child{border-top:0}.top li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tbl{background:var(--panel);border:1px solid var(--rule);border-radius:12px;overflow:auto}
table{border-collapse:collapse;width:100%;min-width:900px}th,td{text-align:left;padding:9px 12px;border-top:1px solid var(--rule);vertical-align:top}th{border-top:0;font-size:12px;color:var(--ink2);font-weight:600;background:color-mix(in srgb,var(--rule) 30%,var(--panel))}
td.nw{white-space:nowrap}.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:1px 8px;margin:1px 0;font-size:12px}.new{font-size:11px;color:var(--ink3)}.ret{font-size:11px;color:var(--acc);font-weight:600}
.q{max-width:360px}.a{max-width:460px;color:var(--ink2)}
.how{background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:14px 18px;margin-top:32px;color:var(--ink2)}.how li{margin:4px 0}
.range a{margin-right:10px}
</style></head><body><div class="wrap">
<h1>Who visited ishirvasavada.com</h1>
<p class="sub">Last ${days} days · times in Eastern · <span class="range"><a href="?key=${k}&days=7">7 days</a><a href="?key=${k}&days=30">30 days</a><a href="?key=${k}&days=90">90 days</a></span></p>
<div class="cards">${card(list.length, 'Visits')}${card(returning, 'Returning visitors')}${card(evCount('demo'), 'Demos opened')}${card(evCount('resume'), 'Resume opens')}${card(chats.length, 'Questions asked')}${card(evCount('email') + evCount('linkedin'), 'Email or LinkedIn clicks')}</div>
<div class="tops">${tops('Where they came from', top(list, source))}${tops('Companies (office networks)', top(list, company))}${tops('Locations', top(list, s => place(s)))}${tops('Demos opened', top(events.filter(e => e.type === 'demo'), e => DEMO[e.detail] || e.detail))}</div>

<h2>Visits</h2>
<div class="tbl"><table><thead><tr><th>When</th><th>Came from</th><th>Location</th><th>Network</th><th>Device</th><th>What they did</th><th>Time on site</th></tr></thead><tbody>
${list.map(s => `<tr><td class="nw">${esc(when(s.ts))}<br>${firstSeen[s.iph] && firstSeen[s.iph] < s.ts ? '<span class="ret">Returning</span>' : '<span class="new">New</span>'}</td><td>${esc(source(s))}</td><td>${esc(place(s))}</td><td>${esc(s.org || '')}</td><td>${esc(s.device || '')}</td><td>${activity(s)}</td><td class="nw">${dur(s.secs)}</td></tr>`).join('') || '<tr><td colspan="7" class="mute">No visits yet</td></tr>'}
</tbody></table></div>

<h2>Questions asked to the assistant</h2>
<div class="tbl"><table><thead><tr><th>When</th><th>Question</th><th>Answer</th><th>Location</th><th>Network</th></tr></thead><tbody>
${chats.map(c => `<tr><td class="nw">${esc(when(c.ts))}</td><td class="q">${esc(c.q)}</td><td class="a">${esc(c.a)}</td><td>${esc(place(c))}</td><td>${esc(c.org || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="mute">No questions yet</td></tr>'}
</tbody></table></div>

<div class="how"><b>Tips</b><ul>
<li><b>Know who opened your link:</b> add a tag when you send it, like <code>ishirvasavada.com/?r=vanta</code> or <code>?r=jane-recruiter</code>. The tag shows under "Came from".</li>
<li><b>Network</b> is the organization that owns the visitor's internet connection. On an office network it's often the employer; at home it's usually the internet provider.</li>
<li><b>Leave yourself out:</b> open <code>ishirvasavada.com/?owner=1</code> once on each browser you use. Visits from that browser stop being counted.</li>
<li>Visitors' IP addresses are never stored. Bots and link previews are skipped.</li>
</ul></div>
</div></body></html>`;
}
