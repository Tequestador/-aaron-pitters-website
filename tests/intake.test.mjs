// Tests for POST /api/intake (functions/api/intake.js) with Turnstile, Resend and OpenAI
// replaced by a fake fetch, so nothing real is called and nothing is sent.
//
// Run:  node scripts/build-prompt.mjs && node --test tests/*.test.mjs

import { test } from 'node:test';
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

// Runs one request through onRequest with a fake network. Options say how each third party
// behaves; the result carries the response and a record of everything that was "sent".
async function submit({
  body = GOOD_BODY,
  env = ENV,
  contentType = 'json',
  turnstileOk = true,
  openai = () => new Response(JSON.stringify({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: BRIEF }] }],
  }), { status: 200 }),
  resend = () => new Response('{"id":"x"}', { status: 200 }),
} = {}) {
  const emails = [];
  const calls = { openai: 0, turnstile: 0 };
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
      return openai(init);
    }
    if (String(url).includes('api.resend.com')) {
      const payload = JSON.parse(init.body);
      const response = resend(payload);
      if (response.ok) emails.push(payload);
      return response;
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const waiting = [];
  const request = contentType === 'json'
    ? new Request('https://aaronpitters.com/api/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    : new Request('https://aaronpitters.com/api/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });
  try {
    const response = await onRequest({ request, env, waitUntil: (p) => waiting.push(p) });
    await Promise.all(waiting); // anything handed to waitUntil has finished before we look
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* a redirect or HTML page */ }
    return { response, json, text, emails, calls };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
}

const toAaron = (emails) => emails.filter((e) => e.to[0] === ENV.NOTIFY_EMAIL);
const toVisitor = (emails) => emails.filter((e) => e.to[0] === GOOD_BODY.email);

// ── The happy path ───────────────────────────────────────────────────────────────────────

test('a good submission: the brief goes to Aaron, a confirmation to the visitor', async () => {
  const { response, json, emails } = await submit();
  assert.equal(response.status, 200);
  assert.deepEqual(json, { ok: true, confirmationSent: true });

  assert.equal(toAaron(emails).length, 1);
  assert.equal(toAaron(emails)[0].subject, '[Triage] Dana L — FREE_SUFFICIENT — Quick Read');
  assert.ok(toAaron(emails)[0].text.includes(GOOD_BODY.q1), 'the verbatim submission is in the brief');

  assert.equal(toVisitor(emails).length, 1);
  assert.equal(toVisitor(emails)[0].subject, 'I got your AI Consulting request');
  assert.equal(toVisitor(emails)[0].reply_to, ENV.NOTIFY_EMAIL);
  assert.ok(toVisitor(emails)[0].text.includes('keep hearing AI could help'));
});

test('a plain form post (no JavaScript) is redirected with ?sent=1', async () => {
  const { response, emails } = await submit({ contentType: 'form' });
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('location')).search, '?sent=1');
  assert.equal(toAaron(emails).length, 1);
});

// ── The non-negotiable behavior: a lead is never lost because the AI step broke ──────────

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
    const { response, json, emails } = await submit(options);

    // The visitor still gets a success: the lead reached Aaron.
    assert.equal(response.status, 200);
    assert.equal(json.ok, true);

    const [email] = toAaron(emails);
    assert.ok(email, 'Aaron was emailed');
    assert.equal(email.subject, '[TRIAGE FAILED] New AI Consulting submission from Dana Lee');
    assert.match(email.text, /^\[TRIAGE FAILED\]/);
    assert.match(email.text, /Reason: .+/);
    // The raw submission, word for word, is what makes the lead recoverable.
    for (const answer of [GOOD_BODY.name, GOOD_BODY.email, GOOD_BODY.business, GOOD_BODY.q1, GOOD_BODY.q2, GOOD_BODY.q3, GOOD_BODY.q4]) {
      assert.ok(email.text.includes(answer), `the failure email includes: ${answer}`);
    }
    assert.ok(email.text.includes('--- SUBMISSION (verbatim) ---'));
    assert.equal(toVisitor(emails).length, 1, 'the visitor still gets the confirmation');
  });
}

test('a line break in the visitor name cannot split the failure email subject', async () => {
  const { emails } = await submit({
    body: { ...GOOD_BODY, name: 'Dana\r\nBcc: evil@example.com' },
    openai: () => new Response('nope', { status: 500 }),
  });
  assert.ok(!toAaron(emails)[0].subject.includes('\n'));
});

// ── When Aaron cannot be emailed, the visitor is told ────────────────────────────────────

test('if the email to Aaron fails, the visitor gets an error and no false confirmation', async () => {
  const { response, json, emails } = await submit({
    resend: (payload) => (payload.to[0] === ENV.NOTIFY_EMAIL ? new Response('{"message":"bad"}', { status: 500 }) : new Response('{}', { status: 200 })),
  });
  assert.equal(response.status, 502);
  assert.equal(json.ok, false);
  assert.equal(json.contact, 'contact@storicore.com');
  assert.equal(toVisitor(emails).length, 0, '"I got your message" would be false');
});

test('if only the confirmation fails, the lead still counts as delivered', async () => {
  const { response, json, emails } = await submit({
    resend: (payload) => (payload.to[0] === GOOD_BODY.email ? new Response('{"message":"bounce"}', { status: 422 }) : new Response('{}', { status: 200 })),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(json, { ok: true, confirmationSent: false });
  assert.equal(toAaron(emails).length, 1);
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
