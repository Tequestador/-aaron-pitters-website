// Tests for POST /api/intake (functions/api/intake.js) with Turnstile, Resend and OpenAI
// replaced by a fake fetch, so nothing real is called and nothing is sent.
//
// The order under test (see the header of intake.js for why):
//   validate + Turnstile -> AWAIT raw email to Aaron -> answer the visitor
//   -> in waitUntil: confirmation -> triage -> brief (or a short [TRIAGE FAILED] email)
//
// Run:  node scripts/build-prompt.mjs && node --test tests/*.test.mjs

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let intake;
try {
  intake = await import('../functions/api/intake.js');
} catch (err) {
  throw new Error(`Could not load intake.js. Run "node scripts/build-prompt.mjs" first. (${err.message})`);
}
const { onRequest } = intake;

const ENV = {
  RESEND_API_KEY: 're_test',
  TURNSTILE_SECRET_KEY: 'ts_test',
  OPENAI_API_KEY: 'sk_test',
  NOTIFY_EMAIL: 'aaron@example.com',
  FROM_EMAIL: 'intake@example.com',
};

const GOOD_BODY = {
  name: 'Dana Lee',
  email: 'dana@example.com',
  business: 'Lee Cleaning',
  q1: 'I run a cleaning business and keep hearing AI could help.',
  q2: 'Spreadsheets and sticky notes.',
  q3: 'Scheduling.',
  q4: 'A direction.',
  'cf-turnstile-response': 'token',
};

const BRIEF = [
  'SUBJECT: [Triage] Dana L — FREE_SUFFICIENT — Quick Read',
  '',
  'VERDICT:        FREE_SUFFICIENT',
  'ONE-LINE READ:  Wants to know where AI fits.',
  '',
  'TOOLS TO RESEARCH (for Aaron only):',
  'none',
  '',
  '--- DRAFT A: the recommended reply ---',
  'Dana,\n\nStart with a shared inbox.',
  '',
  'My take:',
  '[LEAVE BLANK — Aaron writes this.]',
  '',
  'Aaron',
  '',
  '--- DRAFT B: the alternative ---',
  'Dana,\n\nShorter.',
  '',
  'My take:',
  '[LEAVE BLANK — Aaron writes this.]',
  '',
  'Aaron',
].join('\n');

const okBrief = () => new Response(JSON.stringify({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: BRIEF }] }],
}), { status: 200 });
const okMail = () => new Response('{"id":"x"}', { status: 200 });
const failMail = () => new Response('{"message":"nope"}', { status: 500 });

// A fetch that never answers on its own but obeys the caller's timeout, like the real one.
const hang = (init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

const isRaw = (e) => e.to[0] === ENV.NOTIFY_EMAIL && e.subject.startsWith('[New lead]');
const isBrief = (e) => e.to[0] === ENV.NOTIFY_EMAIL && e.subject.startsWith('[Triage]');
const isFailed = (e) => e.to[0] === ENV.NOTIFY_EMAIL && e.subject.startsWith('[TRIAGE FAILED]');
const isConfirmation = (e) => e.to[0] === GOOD_BODY.email;

// Starts one request and returns as soon as the visitor has their response, with the
// background work (the waitUntil promises) possibly still running. Call finish() to let it
// complete and restore the real fetch. Handlers get (payload-or-init) and may be async.
async function start({
  body = GOOD_BODY,
  env = ENV,
  contentType = 'json',
  turnstileOk = true,
  openai = okBrief,
  resend = okMail,        // (payload, init) => Response | Promise<Response>
  withWaitUntil = true,
} = {}) {
  const emails = [];      // emails Resend accepted, in order
  const events = [];      // everything that happened, in order, for ordering checks
  const calls = { openai: 0, turnstile: 0, waitUntil: 0 };
  const realFetch = globalThis.fetch;
  const realError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('challenges.cloudflare.com')) {
      calls.turnstile++;
      return new Response(JSON.stringify({ success: turnstileOk }), { status: 200 });
    }
    if (String(url).includes('api.openai.com')) {
      calls.openai++;
      events.push('openai');
      return openai(init);
    }
    if (String(url).includes('api.resend.com')) {
      const payload = JSON.parse(init.body);
      const label = isRaw(payload) ? 'raw' : isBrief(payload) ? 'brief' : isFailed(payload) ? 'failed' : 'confirmation';
      events.push(`send:${label}`);
      const response = await resend(payload, init);
      if (response.ok) {
        emails.push(payload);
        events.push(`sent:${label}`);
      }
      return response;
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const waiting = [];
  const url = 'https://aaronpitters.com/api/intake';
  const request = contentType === 'json'
    ? new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    : new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });
  const context = { request, env };
  if (withWaitUntil) context.waitUntil = (p) => { calls.waitUntil++; waiting.push(p); };

  const restore = () => {
    globalThis.fetch = realFetch;
    console.error = realError;
  };
  let response;
  try {
    response = await onRequest(context);
  } catch (err) {
    restore();
    throw err;
  }
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* a redirect or HTML page */ }

  return {
    response, json, text, emails, events, calls,
    // Lets the background work finish, then restores the real fetch. Returns whether every
    // waitUntil promise settled without rejecting.
    async finish() {
      try {
        const results = await Promise.allSettled(waiting);
        return results.every((r) => r.status === 'fulfilled');
      } finally {
        restore();
      }
    },
  };
}

async function submit(options) {
  const run = await start(options);
  run.backgroundOk = await run.finish();
  return run;
}

// ── The order ────────────────────────────────────────────────────────────────────────────

test('a good submission: raw email first, then confirmation, triage, brief', async () => {
  const run = await submit();
  assert.equal(run.response.status, 200);
  assert.deepEqual(run.json, { ok: true });
  assert.deepEqual(run.events, [
    'send:raw', 'sent:raw',
    'send:confirmation', 'sent:confirmation',
    'openai',
    'send:brief', 'sent:brief',
  ]);
  assert.equal(run.calls.waitUntil, 1);
  assert.equal(run.emails.filter(isFailed).length, 0, 'no failure email when all went well');
});

test('the raw email has the "[New lead] <First, last initial> — triage to follow" subject and the verbatim answers', async () => {
  const { emails } = await submit();
  const raw = emails.find(isRaw);
  assert.equal(raw.subject, '[New lead] Dana L — triage to follow');
  assert.ok(raw.text.includes('--- SUBMISSION (verbatim) ---'));
  for (const answer of [GOOD_BODY.name, GOOD_BODY.email, GOOD_BODY.business, GOOD_BODY.q1, GOOD_BODY.q2, GOOD_BODY.q3, GOOD_BODY.q4]) {
    assert.ok(raw.text.includes(answer), `the raw email includes: ${answer}`);
  }
});

test('the brief and the confirmation are what they were before the reorder', async () => {
  const { emails } = await submit();
  const brief = emails.find(isBrief);
  assert.equal(brief.subject, '[Triage] Dana L — FREE_SUFFICIENT — Quick Read');
  assert.ok(brief.text.includes(GOOD_BODY.q1), 'the verbatim submission is in the brief');

  const confirmation = emails.find(isConfirmation);
  assert.equal(confirmation.subject, 'I got your AI Consulting request');
  assert.equal(confirmation.reply_to, ENV.NOTIFY_EMAIL);
  assert.ok(confirmation.text.includes('keep hearing AI could help'));
});

test('the visitor gets their answer before the confirmation, the AI call or the brief', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = await start({ openai: async () => { await gate; return okBrief(); } });
  try {
    // The response is already here, and the raw email is already sent...
    assert.equal(run.response.status, 200);
    assert.deepEqual(run.json, { ok: true });
    assert.ok(run.events.includes('sent:raw'));
    // ...while the AI is still "thinking" and no brief exists.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(run.events.includes('openai'), 'triage has started in the background');
    assert.ok(!run.events.includes('send:brief'));
  } finally {
    release();
  }
  assert.equal(await run.finish(), true);
  assert.ok(run.emails.some(isBrief));
});

test('a plain form post (no JavaScript) is redirected with ?sent=1', async () => {
  const { response, emails } = await submit({ contentType: 'form' });
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('location')).search, '?sent=1');
  assert.ok(emails.some(isRaw));
  assert.ok(emails.some(isBrief));
});

test('without waitUntil the background work is awaited, not dropped', async () => {
  const { emails } = await submit({ withWaitUntil: false });
  assert.ok(emails.some(isBrief));
  assert.ok(emails.some(isConfirmation));
});

// ── No lead is lost: the raw email is the guarantee ──────────────────────────────────────

test('if the raw email cannot be sent, the visitor gets the error and nothing else happens', async () => {
  const { response, json, emails, calls } = await submit({
    resend: (payload) => (isRaw(payload) ? failMail() : okMail()),
  });
  assert.equal(response.status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.contact, 'contact@storicore.com');
  assert.equal(emails.length, 0, '"I got your message" would be false: no confirmation either');
  assert.equal(calls.openai, 0);
  assert.equal(calls.waitUntil, 0, 'no background work for a lead that was not delivered');
});

test('the same error comes back for a form post, as a readable page', async () => {
  const { response, text } = await submit({
    contentType: 'form',
    resend: (payload) => (isRaw(payload) ? failMail() : okMail()),
  });
  assert.equal(response.status, 502);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(text, /contact@storicore\.com/);
});

// ── The [TRIAGE FAILED] fallback ─────────────────────────────────────────────────────────

const aiFailures = {
  'OpenAI returns HTTP 500': { openai: () => new Response('{"error":{"code":"server_error"}}', { status: 500 }) },
  'OpenAI returns HTTP 429': { openai: () => new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429 }) },
  'OpenAI returns an HTML page': { openai: () => new Response('<html>oops</html>', { status: 200 }) },
  'the network call throws': { openai: () => { throw new TypeError('fetch failed'); } },
  'the answer is not a brief': {
    openai: () => new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'I cannot help with that.' }] }],
    }), { status: 200 }),
  },
  'the OpenAI key is missing': { env: { ...ENV, OPENAI_API_KEY: undefined } },
};

for (const [name, options] of Object.entries(aiFailures)) {
  test(`[TRIAGE FAILED] fallback: ${name}`, async () => {
    const { response, json, emails, events, backgroundOk } = await submit(options);

    assert.equal(response.status, 200, 'the visitor still gets a success');
    assert.equal(json.ok, true);
    assert.equal(backgroundOk, true);

    assert.equal(emails.filter(isRaw).length, 1, 'the raw submission reached Aaron');
    assert.equal(emails.filter(isBrief).length, 0);

    const [failed] = emails.filter(isFailed);
    assert.ok(failed, 'Aaron got the failure email');
    assert.equal(failed.subject, '[TRIAGE FAILED] Dana Lee');
    assert.match(failed.text, /^\[TRIAGE FAILED\]/);
    assert.match(failed.text, /Reason: .+/);
    assert.match(failed.text, /already arrived in the "\[New lead\]" email/);
    assert.ok(!failed.text.includes(GOOD_BODY.q1), 'short: the submission is not repeated');

    assert.ok(emails.some(isConfirmation), 'the visitor still gets the confirmation');
    assert.ok(events.indexOf('sent:raw') < events.indexOf('send:failed'), 'raw first, failure note after');
  });
}

test('if the brief cannot be emailed, Aaron is told it is not coming', async () => {
  const { emails } = await submit({
    resend: (payload) => (isBrief(payload) ? failMail() : okMail()),
  });
  assert.equal(emails.filter(isBrief).length, 0);
  const [failed] = emails.filter(isFailed);
  assert.ok(failed);
  assert.match(failed.text, /could not be sent/);
});

test('if even the failure email cannot be sent, nothing throws', async () => {
  const run = await submit({
    openai: () => new Response('nope', { status: 500 }),
    resend: (payload) => (isFailed(payload) ? failMail() : okMail()),
  });
  assert.equal(run.response.status, 200);
  assert.equal(run.backgroundOk, true);
  assert.ok(run.emails.some(isRaw));
});

test('if only the confirmation fails, triage and the brief still happen', async () => {
  const { response, emails, backgroundOk } = await submit({
    resend: (payload) => (isConfirmation(payload) ? new Response('{"message":"bounce"}', { status: 422 }) : okMail()),
  });
  assert.equal(response.status, 200);
  assert.equal(backgroundOk, true);
  assert.ok(emails.some(isRaw));
  assert.ok(emails.some(isBrief));
  assert.ok(!emails.some(isConfirmation));
});

test('a line break in the visitor name cannot split any subject line', async () => {
  const { emails } = await submit({
    body: { ...GOOD_BODY, name: 'Dana\r\nBcc: evil@example.com' },
    openai: () => new Response('nope', { status: 500 }),
  });
  for (const email of emails) assert.ok(!email.subject.includes('\n'), email.subject);
});

const names = {
  'Dana Lee': 'Dana L',
  'Cher': 'Cher',
  'mary jo van der berg': 'mary B',
  '  Ana   Ruiz  ': 'Ana R',
};
for (const [name, short] of Object.entries(names)) {
  test(`raw email subject uses first name and last initial: "${name}" -> "${short}"`, async () => {
    const { emails } = await submit({ body: { ...GOOD_BODY, name } });
    assert.equal(emails.find(isRaw).subject, `[New lead] ${short} — triage to follow`);
  });
}

// ── The 30-second waitUntil limit ────────────────────────────────────────────────────────
// Cloudflare cancels waitUntil work 30 seconds after the response. These tests run the
// background chain on a fake clock and check it stays inside that, whatever hangs.

// Advances the fake clock in small steps until the background work settles. Returns the
// fake milliseconds it took, and what the OpenAI request's abort time was.
async function runOnFakeClock(options) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let run;
  try {
    run = await start(options);
    let settled = false;
    const done = run.finish().then(() => { settled = true; });
    let elapsed = 0;
    while (!settled && elapsed < 120000) {
      mock.timers.tick(50);
      elapsed += 50;
      await new Promise((resolve) => setImmediate(resolve));
    }
    await done;
    return { run, elapsed };
  } finally {
    mock.timers.reset();
  }
}

test('everything in the background hanging: the chain still ends well under 30 seconds', async () => {
  const { run, elapsed } = await runOnFakeClock({
    openai: hang,
    // The raw email (before the response) must work; every background send hangs.
    resend: (payload, init) => (isRaw(payload) ? okMail() : hang(init)),
  });
  assert.equal(run.response.status, 200);
  assert.ok(elapsed < 28000, `took ${elapsed} ms of fake time`);
  assert.ok(elapsed >= 15000, 'and it did actually wait for the timeouts, not skip them');
});

test('only the AI hangs: triage gives up at about 20 seconds and the failure email follows', async () => {
  const { run, elapsed } = await runOnFakeClock({ openai: hang });
  assert.ok(elapsed >= 19000 && elapsed <= 21000, `triage timed out after ${elapsed} ms`);
  const [failed] = run.emails.filter(isFailed);
  assert.ok(failed);
  assert.match(failed.text, /did not answer within 20 seconds/);
});

test('a slow confirmation email shortens the AI wait instead of pushing past 30 seconds', async () => {
  const { run, elapsed } = await runOnFakeClock({
    openai: hang,
    resend: (payload, init) => (isConfirmation(payload) ? hang(init) : okMail()),
  });
  // Confirmation 5s, then triage gets 25 - 5 - 5 = 15s: about 20s in all, not 25.
  assert.ok(elapsed >= 19000 && elapsed <= 21000, `chain took ${elapsed} ms`);
  const [failed] = run.emails.filter(isFailed);
  assert.match(failed.text, /did not answer within 15 seconds/);
});

// ── Validation and Turnstile come before anything that costs money ───────────────────────

test('a failed Turnstile check is refused before OpenAI or any email', async () => {
  const { response, calls, emails } = await submit({ turnstileOk: false });
  assert.equal(response.status, 400);
  assert.equal(calls.openai, 0);
  assert.equal(emails.length, 0);
});

test('a missing Turnstile token is refused', async () => {
  const body = { ...GOOD_BODY };
  delete body['cf-turnstile-response'];
  const { response, calls, emails } = await submit({ body });
  assert.equal(response.status, 400);
  assert.equal(calls.turnstile, 0);
  assert.equal(emails.length, 0);
});

const badInputs = {
  'a missing name': { ...GOOD_BODY, name: '  ' },
  'a missing first question': { ...GOOD_BODY, q1: '' },
  'a bad email address': { ...GOOD_BODY, email: 'not-an-email' },
  'two addresses in the email field': { ...GOOD_BODY, email: 'a@x.com,b@y.com' },
  'an over-long answer': { ...GOOD_BODY, q1: 'x'.repeat(4001) },
  'an answer that is not text': { ...GOOD_BODY, q2: 42 },
};

for (const [name, body] of Object.entries(badInputs)) {
  test(`validation refuses ${name}`, async () => {
    const { response, calls, emails } = await submit({ body });
    assert.equal(response.status, 400);
    assert.equal(calls.openai, 0);
    assert.equal(emails.length, 0);
  });
}

test('anything but POST is refused with 405', async () => {
  const realError = console.error;
  console.error = () => {};
  try {
    const get = await onRequest({
      request: new Request('https://aaronpitters.com/api/intake', { method: 'GET' }),
      env: ENV,
      waitUntil() {},
    });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
  } finally {
    console.error = realError;
  }
});
