// Proves the public routes fail closed when their secrets are missing,
// and accept only the right webhook key. Run: node worker/failclosed.test.mjs
import worker from './worker.js';
const ctx = { waitUntil() {} };
let fails = 0;
async function check(name, req, env, want) {
  const res = await worker.fetch(req, env, ctx);
  const ok = res.status === want;
  if (!ok) fails++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name} (got ${res.status}, want ${want})`);
}
const base = 'https://luxiga-crm-api.example/api';
const form = () => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=unsubscribe&data[email]=a@x.com' });
await check('webhook, no key configured', new Request(base + '/mailchimp/webhook', form()), {}, 404);
await check('webhook, wrong key', new Request(base + '/mailchimp/webhook?k=nope', form()), { MAILCHIMP_WEBHOOK_KEY: 'right-key-123' }, 404);
await check('webhook GET, right key', new Request(base + '/mailchimp/webhook?k=right-key-123'), { MAILCHIMP_WEBHOOK_KEY: 'right-key-123' }, 200);
const wr = () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', email: 'victim@example.com' }) });
await check('work-request, Turnstile not configured', new Request(base + '/work-request', wr()), {}, 503);
await check('work-request, no Turnstile token', new Request(base + '/work-request', wr()), { TURNSTILE_SECRET: 's' }, 403);
console.log(fails ? `\n${fails} FAILED` : '\nall fail-closed checks passed');
process.exit(fails ? 1 : 0);
