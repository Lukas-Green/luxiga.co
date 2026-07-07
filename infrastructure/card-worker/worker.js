/**
 * LUXIGA card-worker
 * Backend for luxiga.co/card: captures work-request leads + interaction events,
 * stores them in Airtable, emails Lukas on each new lead, and serves a private
 * dashboard. Deploy with wrangler (see README.md).
 *
 * Routes:
 *   OPTIONS *          CORS preflight
 *   POST /lead         { name, contact, message, source, sid } -> Airtable Leads + email
 *   POST /event        { event, source, sid, path, ts, meta }  -> Airtable Events (best-effort)
 *   GET  /dashboard    private dashboard HTML (prompts for token, stored client-side)
 *   GET  /api/data     Bearer DASH_TOKEN -> { leads, events } JSON
 *
 * Secrets (wrangler secret put ...):
 *   AIRTABLE_TOKEN, AIRTABLE_BASE, RESEND_KEY, NOTIFY_EMAIL, DASH_TOKEN
 * Vars (wrangler.toml [vars] or defaults below):
 *   AIRTABLE_LEADS_TABLE=Leads, AIRTABLE_EVENTS_TABLE=Events,
 *   FROM_EMAIL=leads@luxiga.co, ALLOW_ORIGIN=https://luxiga.co
 */

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });

function cors(env, req) {
  const allow = env.ALLOW_ORIGIN || "https://luxiga.co";
  const origin = req.headers.get("Origin") || "";
  // allow the configured origin (and localhost during testing)
  const ok = origin === allow || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allow,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

async function parseBody(req) {
  // sendBeacon posts text/plain; leads post JSON. Handle both.
  const raw = await req.text();
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function esc(s) {
  return String(s == null ? "" : s).slice(0, 4000);
}

// ---- Airtable ----
function airtableUrl(env, table) {
  return `https://api.airtable.com/v0/${env.AIRTABLE_BASE}/${encodeURIComponent(table)}`;
}
async function airtableCreate(env, table, fields) {
  const res = await fetch(airtableUrl(env, table), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) throw new Error(`airtable ${table} ${res.status}: ${await res.text()}`);
  return res.json();
}
async function airtableList(env, table, max = 100) {
  const url = `${airtableUrl(env, table)}?pageSize=${max}&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
  if (!res.ok) throw new Error(`airtable list ${table} ${res.status}`);
  const data = await res.json();
  return (data.records || []).map((r) => ({ id: r.id, ...r.fields }));
}

// ---- Resend email ----
async function sendLeadEmail(env, lead) {
  if (!env.RESEND_KEY || !env.NOTIFY_EMAIL) return;
  const from = env.FROM_EMAIL || "leads@luxiga.co";
  const html =
    `<h2>New work request</h2>` +
    `<p><b>Name:</b> ${esc(lead.name)}</p>` +
    `<p><b>Contact:</b> ${esc(lead.contact)}</p>` +
    `<p><b>Source:</b> ${esc(lead.source || "direct")}</p>` +
    `<p><b>Message:</b><br>${esc(lead.message).replace(/\n/g, "<br>")}</p>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `LUXIGA Card <${from}>`,
      to: [env.NOTIFY_EMAIL],
      reply_to: /@/.test(lead.contact) ? lead.contact : undefined,
      subject: `Work request from ${esc(lead.name)}${lead.source && lead.source !== "direct" ? ` (${esc(lead.source)})` : ""}`,
      html,
    }),
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ch = cors(env, req);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });

    // --- lead capture ---
    if (req.method === "POST" && path === "/lead") {
      const b = await parseBody(req);
      const name = esc(b.name).trim(), contact = esc(b.contact).trim(), message = esc(b.message).trim();
      if (!name || !contact || !message) return json({ ok: false, error: "missing fields" }, 400, ch);
      const lead = { name, contact, message, source: esc(b.source) || "direct", sid: esc(b.sid) };
      try {
        await airtableCreate(env, env.AIRTABLE_LEADS_TABLE || "Leads", {
          Name: lead.name, Contact: lead.contact, Message: lead.message,
          Source: lead.source, Session: lead.sid,
        });
        ctx.waitUntil(sendLeadEmail(env, lead));
        return json({ ok: true }, 200, ch);
      } catch (e) {
        return json({ ok: false, error: String(e).slice(0, 200) }, 502, ch);
      }
    }

    // --- interaction event (best-effort, never blocks the client) ---
    if (req.method === "POST" && path === "/event") {
      const b = await parseBody(req);
      const ev = esc(b.event).trim();
      if (ev) {
        ctx.waitUntil(
          airtableCreate(env, env.AIRTABLE_EVENTS_TABLE || "Events", {
            Event: ev, Source: esc(b.source) || "direct", Session: esc(b.sid),
            Path: esc(b.path), Meta: JSON.stringify(b.meta || {}).slice(0, 1000),
          }).catch(() => {})
        );
      }
      return new Response(null, { status: 204, headers: ch });
    }

    // --- dashboard data (token-gated) ---
    if (req.method === "GET" && path === "/api/data") {
      const auth = req.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (!env.DASH_TOKEN || token !== env.DASH_TOKEN) return json({ error: "unauthorized" }, 401, ch);
      try {
        const [leads, events] = await Promise.all([
          airtableList(env, env.AIRTABLE_LEADS_TABLE || "Leads", 100),
          airtableList(env, env.AIRTABLE_EVENTS_TABLE || "Events", 500),
        ]);
        return json({ leads, events }, 200, ch);
      } catch (e) {
        return json({ error: String(e).slice(0, 200) }, 502, ch);
      }
    }

    // --- dashboard page ---
    if (req.method === "GET" && (path === "/dashboard" || path === "/")) {
      return new Response(DASHBOARD_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return json({ error: "not found" }, 404, ch);
  },
};

const DASHBOARD_HTML = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Card Dashboard &middot; LUXIGA</title>
<style>
:root{--bg:#080810;--panel:#11111c;--line:rgba(196,255,83,.14);--ink:#f0f1ea;--muted:#8f9a78;--lime:#C4FF53}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font-family:ui-sans-serif,-apple-system,'Helvetica Neue',Arial,sans-serif;padding:24px;line-height:1.5}
.wrap{max-width:960px;margin:0 auto}
h1{font-size:22px;margin:0 0 2px}.sub{color:var(--muted);font-size:13px;margin:0 0 22px}
.gate{max-width:360px;margin:60px auto;text-align:center;display:flex;flex-direction:column;gap:12px}
input{font:inherit;font-size:15px;color:var(--ink);background:#0c0c16;border:1px solid var(--line);border-radius:10px;padding:12px 13px}
button{font:inherit;font-weight:600;font-size:15px;background:var(--lime);color:#0a0a0a;border:0;border-radius:10px;padding:12px;cursor:pointer}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:24px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.tile .n{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.tile .l{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:600}
h2{font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin:22px 0 10px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600}
.src{display:inline-block;background:rgba(196,255,83,.12);color:var(--lime);border-radius:5px;padding:1px 7px;font-size:11px;font-weight:600}
.scroll{overflow-x:auto}.err{color:#ff9b9b}
</style></head><body><div class="wrap" id="app">
<div class="gate" id="gate">
  <h1>Card Dashboard</h1><p class="sub">Enter your dashboard token.</p>
  <input id="tok" type="password" placeholder="Dashboard token" autocomplete="off">
  <button onclick="load()">View</button><p class="err" id="err"></p>
</div></div>
<script>
var API="/api/data";
function esc(s){return String(s==null?"":s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
function fmt(t){if(!t)return"";try{return new Date(t).toLocaleString()}catch(e){return t}}
async function load(){
  var tok=document.getElementById("tok")?document.getElementById("tok").value:localStorage.getItem("lx_dash");
  if(!tok){return}
  var r=await fetch(API,{headers:{Authorization:"Bearer "+tok}});
  if(!r.ok){document.getElementById("err").textContent=r.status===401?"Wrong token.":"Error "+r.status;return}
  localStorage.setItem("lx_dash",tok);
  var d=await r.json();render(d)
}
function render(d){
  var leads=d.leads||[],events=d.events||[];
  var byEv={},bySrc={};
  events.forEach(function(e){byEv[e.Event]=(byEv[e.Event]||0)+1;bySrc[e.Source||"direct"]=(bySrc[e.Source||"direct"]||0)+1});
  var views=byEv.view||0,submits=byEv.lead_submit||0;
  var tiles=[["Leads",leads.length],["Views",views],["Requests opened",byEv.open_request||0],["Submits",submits]];
  var srcRows=Object.keys(bySrc).sort(function(a,b){return bySrc[b]-bySrc[a]})
    .map(function(s){return"<tr><td><span class=src>"+esc(s)+"</span></td><td>"+bySrc[s]+"</td></tr>"}).join("");
  var leadRows=leads.map(function(l){return"<tr><td>"+esc(l.Name)+"</td><td>"+esc(l.Contact)+"</td><td>"+esc(l.Message)+"</td><td><span class=src>"+esc(l.Source||"direct")+"</span></td><td>"+fmt(l.Created)+"</td></tr>"}).join("");
  var evRows=events.slice(0,60).map(function(e){return"<tr><td>"+esc(e.Event)+"</td><td><span class=src>"+esc(e.Source||"direct")+"</span></td><td>"+esc(e.Meta||"")+"</td><td>"+fmt(e.Created)+"</td></tr>"}).join("");
  document.getElementById("app").innerHTML=
    "<h1>Card Dashboard</h1><p class=sub>luxiga.co/card activity</p>"+
    "<div class=tiles>"+tiles.map(function(t){return"<div class=tile><div class=n>"+t[1]+"</div><div class=l>"+t[0]+"</div></div>"}).join("")+"</div>"+
    "<h2>Leads</h2><div class=scroll><table><tr><th>Name</th><th>Contact</th><th>Message</th><th>Source</th><th>When</th></tr>"+(leadRows||"<tr><td colspan=5>No leads yet.</td></tr>")+"</table></div>"+
    "<h2>By source</h2><div class=scroll><table><tr><th>Source</th><th>Events</th></tr>"+(srcRows||"<tr><td colspan=2>No events yet.</td></tr>")+"</table></div>"+
    "<h2>Recent activity</h2><div class=scroll><table><tr><th>Event</th><th>Source</th><th>Detail</th><th>When</th></tr>"+(evRows||"<tr><td colspan=4>No events yet.</td></tr>")+"</table></div>"
}
if(localStorage.getItem("lx_dash")){load()}
</script></body></html>`;
