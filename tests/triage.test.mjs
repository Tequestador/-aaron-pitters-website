// Tests for functions/api/_triage.js: the brief email built from the model's answer, and
// runTriage()'s promise that it never throws.
//
// Run:  node scripts/build-prompt.mjs && node --test tests/*.test.mjs
// (_triage.js imports the generated rubric module, so the build script has to run first.
// No packages: this is Node's built-in test runner.)

import { test } from 'node:test';
import assert from 'node:assert/strict';

let triage;
try {
  triage = await import('../functions/api/_triage.js');
} catch (err) {
  throw new Error(`Could not load _triage.js. Run "node scripts/build-prompt.mjs" first. (${err.message})`);
}
const { buildBriefEmail, runTriage } = triage;

const PLACEHOLDER = '[LEAVE BLANK — Aaron writes this.]';
const SUBMISSION = 'Name:     Dana Lee\nEmail:    dana@example.com\n\n1. What made you contact me?\nI run a cleaning business.';

// A brief in the shape rubric §7 prescribes. Pass overrides to vary one part at a time.
function brief({
  tools = 'Zapier (unverified) — connects forms to email\nMake (unverified) — similar, worth comparing',
  draftA = 'Dana,\n\nThis is a Quick Read. Start with a shared inbox.',
  draftB = 'Dana,\n\nA shorter free answer.',
  takeA = `My take:\n${PLACEHOLDER}\n\nAaron`,
  takeB = `My take:\n${PLACEHOLDER}\n\nAaron`,
  echo = '--- SUBMISSION (verbatim) ---\nTHE MODEL REWROTE THIS',
} = {}) {
  return [
    'SUBJECT: [Triage] Dana L — FREE_SUFFICIENT — Quick Read',
    '',
    'VERDICT:        FREE_SUFFICIENT',
    'ONE-LINE READ:  A cleaning business owner asking where AI fits.',
    '',
    'FLAGS:          none',
    '',
    'THE ONE USEFUL THING:',
    'A shared inbox would fix most of this.',
    '',
    'TOOLS TO RESEARCH (for Aaron only):',
    tools,
    '',
    'WHERE YOUR JUDGMENT IS NEEDED:',
    "I can't tell why she wrote in now.",
    '',
    'CONFIDENCE:     high — clear question',
    '',
    '--- DRAFT A: the recommended reply ---',
    draftA,
    '',
    takeA,
    '',
    '--- DRAFT B: the alternative ---',
    draftB,
    '',
    takeB,
    '',
    echo,
  ].join('\n');
}

const build = (opts) => buildBriefEmail(brief(opts), SUBMISSION);
const count = (text, needle) => text.split(needle).length - 1;

// ── The My take guard (existing behavior) ────────────────────────────────────────────────

test('a clean brief: subject split off, no warnings, one empty slot per draft', () => {
  const { subject, text } = build();
  assert.equal(subject, '[Triage] Dana L — FREE_SUFFICIENT — Quick Read');
  assert.ok(!text.startsWith('SUBJECT'), 'the SUBJECT line is removed from the body');
  assert.ok(!text.includes('WARNING'));
  assert.ok(!text.includes('NOTE:'));
  assert.equal(count(text, 'MY TAKE IS EMPTY'), 2);
  assert.equal(count(text, PLACEHOLDER), 2);
});

test('text the model wrote under My take is removed, and Aaron is warned', () => {
  const { text } = build({ takeA: `My take:\nHonestly I think she should hire someone.\n\nAaron` });
  assert.ok(!text.includes('hire someone'));
  assert.match(text, /NOTE: the model wrote text under My take in 1 draft\(s\)/);
  assert.equal(count(text, PLACEHOLDER), 2);
});

test('text on the same line as "My take:" is removed too', () => {
  const { text } = build({ takeA: 'My take: She is a great fit.\n\nAaron' });
  assert.ok(!text.includes('great fit'));
  assert.match(text, /NOTE: the model wrote text under My take in 1 draft/);
});

test('bold "**My take:**" is still recognized and its text removed', () => {
  const { text } = build({ takeA: '**My take:**\nSecret opinion.\n\nAaron' });
  assert.ok(!text.includes('Secret opinion'));
  assert.match(text, /NOTE:/);
});

test('both drafts filled: the warning counts both', () => {
  const { text } = build({
    takeA: 'My take:\nOpinion one.\n\nAaron',
    takeB: 'My take:\nOpinion two.\n\nAaron',
  });
  assert.match(text, /in 2 draft\(s\)/);
  assert.ok(!text.includes('Opinion'));
});

test('a draft with no My take at all gets the slot, without a warning', () => {
  const { text } = build({ takeA: '' });
  assert.equal(count(text, 'MY TAKE IS EMPTY'), 2);
  assert.ok(!text.includes('NOTE:'));
});

test('the loud banner is kept', () => {
  const { text } = build();
  assert.match(text, /##  MY TAKE IS EMPTY\. YOU WRITE THIS\. DO NOT SEND UNTIL IT IS\. ##/);
});

// ── Sign-off order (3a) ──────────────────────────────────────────────────────────────────

test('a single "Aaron" sign-off after the placeholder is kept, with no warning', () => {
  const { text } = build();
  assert.ok(!text.includes('NOTE:'));
  // Placeholder, blank line, Aaron: the order the rubric prescribes.
  assert.equal(count(text, `My take:\n${PLACEHOLDER}\n\nAaron\n`), 2);
});

test('the sign-off sits after the placeholder and before the closing banner', () => {
  const { text } = build();
  const draftA = text.slice(text.indexOf('--- DRAFT A'), text.indexOf('--- DRAFT B'));
  const at = (s) => draftA.indexOf(s);
  assert.ok(at(PLACEHOLDER) < at('\nAaron\n'));
  assert.ok(at('\nAaron\n') < draftA.lastIndexOf('####'));
});

test('a bold or italic **Aaron** counts as the sign-off', () => {
  const { text } = build({ takeA: `My take:\n${PLACEHOLDER}\n\n**Aaron**` });
  assert.ok(!text.includes('NOTE:'));
  assert.ok(!text.includes('**Aaron**'), 'normalized to plain Aaron');
  assert.equal(count(text, `${PLACEHOLDER}\n\nAaron\n`), 2);
});

test('other text in My take is still discarded and still warns, even with a sign-off', () => {
  const { text } = build({ takeA: `My take:\n${PLACEHOLDER}\nI would take this client.\n\nAaron` });
  assert.ok(!text.includes('I would take this client'));
  assert.match(text, /NOTE: the model wrote text under My take in 1 draft/);
  assert.equal(count(text, PLACEHOLDER), 2);
});

test('text after the sign-off is discarded and warns', () => {
  const { text } = build({ takeA: `My take:\n${PLACEHOLDER}\n\nAaron\n\nP.S. call her today.` });
  assert.ok(!text.includes('P.S.'));
  assert.match(text, /NOTE: the model wrote text under My take in 1 draft/);
});

test('a name other than a lone "Aaron" is not a sign-off: it is removed and warns', () => {
  const { text } = build({ takeA: `My take:\n${PLACEHOLDER}\n\nAaron Pitters, STORiCORE` });
  assert.ok(!text.includes('STORiCORE'));
  assert.match(text, /NOTE:/);
});

test('two "Aaron" lines are one sign-off plus extra text: one is kept, and it warns', () => {
  const { text } = build({ takeA: `My take:\n${PLACEHOLDER}\n\nAaron\nAaron` });
  assert.match(text, /NOTE: the model wrote text under My take in 1 draft/);
  // Draft A keeps one sign-off, Draft B keeps its own: two in the whole email body.
  assert.equal(count(text.slice(0, text.indexOf('--- SUBMISSION')), '\nAaron\n'), 2);
});

test('no sign-off written: the slot is still added, without a made-up one', () => {
  const { text } = build({ takeA: `My take:\n${PLACEHOLDER}` });
  const draftA = text.slice(text.indexOf('--- DRAFT A'), text.indexOf('--- DRAFT B'));
  assert.ok(!draftA.includes('Aaron\n'), 'nothing invented');
  assert.ok(!text.includes('NOTE:'));
});

// ── The submission shown to Aaron is the real one (existing behavior) ────────────────────

test("the model's echo of the submission is replaced with the verbatim original", () => {
  const { text } = build();
  assert.ok(!text.includes('THE MODEL REWROTE THIS'));
  const tail = text.slice(text.lastIndexOf('--- SUBMISSION (verbatim) ---'));
  assert.equal(tail, `--- SUBMISSION (verbatim) ---\n${SUBMISSION}\n`);
  assert.equal(count(text, '--- SUBMISSION'), 1);
});

test('the real submission is appended even if the model left out its echo', () => {
  const { text } = build({ echo: '' });
  assert.ok(text.endsWith(`--- SUBMISSION (verbatim) ---\n${SUBMISSION}\n`));
});

test('a code fence around the whole answer is stripped', () => {
  const { subject, text } = buildBriefEmail('```\n' + brief() + '\n```', SUBMISSION);
  assert.match(subject, /^\[Triage\]/);
  assert.ok(!text.includes('```'));
});

// ── Not a brief at all: buildBriefEmail throws, runTriage turns that into a failure ──────

test('text that is not a brief is refused', () => {
  assert.throws(() => buildBriefEmail("I'm sorry, I can't help with that.", SUBMISSION), /SUBJECT/);
  assert.throws(
    () => buildBriefEmail(brief().replace('VERDICT:        FREE_SUFFICIENT', 'VERDICT:        MAYBE'), SUBMISSION),
    /VERDICT/,
  );
  assert.throws(
    () => buildBriefEmail(brief().replace('VERDICT:        FREE_SUFFICIENT\n', ''), SUBMISSION),
    /VERDICT/,
  );
});

// ── TOOLS TO RESEARCH (3b): not rejected, not garbled ────────────────────────────────────

test('the TOOLS TO RESEARCH field comes through the brief untouched', () => {
  const tools = [
    'Zapier (unverified) — connects forms to email',
    'Airtable (unverified) — for a simple client list',
    'Make (unverified) — worth comparing',
  ].join('\n');
  const { text } = build({ tools });
  assert.ok(text.includes(`TOOLS TO RESEARCH (for Aaron only):\n${tools}\n\nWHERE YOUR JUDGMENT IS NEEDED:`));
});

test('"none" in the field is accepted', () => {
  const { text, subject } = build({ tools: 'none' });
  assert.ok(subject);
  assert.ok(text.includes('TOOLS TO RESEARCH (for Aaron only):\nnone'));
  assert.ok(!text.includes('WARNING'));
});

test('a brief missing the field entirely is still a brief', () => {
  const raw = brief().replace(/TOOLS TO RESEARCH[\s\S]*?\n\n(?=WHERE YOUR JUDGMENT)/, '');
  assert.ok(!raw.includes('TOOLS TO RESEARCH'));
  const { text } = buildBriefEmail(raw, SUBMISSION);
  assert.ok(!text.includes('WARNING'));
});

test('the field header can be written without "(for Aaron only)"', () => {
  const raw = brief({ draftA: 'Dana,\n\nTry Zapier for this.' }).replace('TOOLS TO RESEARCH (for Aaron only):', 'TOOLS TO RESEARCH:');
  assert.match(buildBriefEmail(raw, SUBMISSION).text, /WARNING.*Zapier \(Draft A\)/);
});

test('a tool named in a draft puts a warning at the top, and the brief is still sent', () => {
  const { text, subject } = build({ draftA: 'Dana,\n\nYou could try Zapier to forward those emails.' });
  assert.ok(subject, 'not blocked');
  assert.ok(text.startsWith('WARNING: a tool from TOOLS TO RESEARCH appears in a draft: Zapier (Draft A).'));
  assert.ok(text.includes('You could try Zapier'), 'the draft itself is left as written');
  assert.ok(text.includes('--- DRAFT B'), 'both drafts still present');
});

test('the warning names every tool and every draft it appears in', () => {
  const { text } = build({
    draftA: 'Dana,\n\nZapier would do it.',
    draftB: 'Dana,\n\nOr Make, or Zapier.',
  });
  const warning = text.split('\n')[0];
  assert.match(warning, /Zapier \(Draft A\)/);
  assert.match(warning, /Zapier \(Draft B\)/);
  assert.match(warning, /Make \(Draft B\)/);
});

test('no warning when the drafts do not name a researched tool', () => {
  assert.ok(!build().text.includes('WARNING'));
});

test('the tool is matched as a whole word', () => {
  const { text } = build({ tools: 'Zap (unverified) — short name', draftA: 'Dana,\n\nZapier is a thing.' });
  assert.ok(!text.includes('WARNING'));
});

test('a common word is not a tool: "make" in a draft does not trip the Make product', () => {
  const { text } = build({ draftA: 'Dana,\n\nLet us make this simpler. We can make a list.' });
  assert.ok(!text.includes('WARNING'));
});

test('a tool the client named themselves may appear in a draft without a warning', () => {
  const submission = `${SUBMISSION}\nI already use zapier for invoices.`;
  const { text } = buildBriefEmail(brief({ draftA: 'Dana,\n\nSince you already use Zapier, keep it.' }), submission);
  assert.ok(!text.includes('WARNING'));
});

test('tool names are found whatever the line format (bullets, dash before reason, colon)', () => {
  const tools = [
    '- Zapier — connects forms (unverified)',
    '2. Notion AI: for notes (unverified)',
    '**Airtable** (unverified), a simple client list',
  ].join('\n');
  const { text } = build({
    tools,
    draftA: 'Dana,\n\nZapier. Notion AI. Airtable.',
    draftB: 'Dana,\n\nNothing here.',
  });
  const warning = text.split('\n')[0];
  assert.match(warning, /Zapier \(Draft A\)/);
  assert.match(warning, /Notion AI \(Draft A\)/);
  assert.match(warning, /Airtable \(Draft A\)/);
});

test('a tool named only inside My take text (which is thrown away) does not warn', () => {
  const { text } = build({ takeA: `My take:\nTry Zapier.\n\nAaron` });
  assert.ok(!text.includes('WARNING'));
  assert.match(text, /NOTE:/, 'the filled My take still warns on its own');
});

test('the tool warning and the My take warning can appear together, tool warning first', () => {
  const { text } = build({
    draftA: 'Dana,\n\nTry Zapier.',
    takeA: `My take:\nMy opinion.\n\nAaron`,
  });
  const lines = text.split('\n');
  assert.match(lines[0], /^WARNING:/);
  assert.ok(text.indexOf('NOTE:') > text.indexOf('WARNING:'));
  assert.ok(text.indexOf('NOTE:') < text.indexOf('--- DRAFT A'));
});

test('regex characters in a tool name are treated as plain text', () => {
  const { text } = build({ tools: 'C++ (unverified) — odd name\n(.*) (unverified) — hostile', draftA: 'Dana,\n\nWe like C++ here.' });
  assert.match(text.split('\n')[0], /C\+\+ \(Draft A\)/);
});

// ── runTriage never throws, and says why it failed (existing behavior) ───────────────────

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  const realError = console.error;
  console.error = () => {}; // runTriage logs failures; keep test output quiet
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = real;
    console.error = realError;
  });
}

const openAiAnswer = (text) => new Response(JSON.stringify({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
}), { status: 200 });

test('runTriage: a good answer becomes a brief', async () => {
  const result = await withFetch(async () => openAiAnswer(brief()), () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION));
  assert.equal(result.ok, true);
  assert.match(result.subject, /^\[Triage\]/);
  assert.ok(result.text.includes(SUBMISSION));
});

test('runTriage: the submission is sent inside boundary lines, the rubric as instructions', async () => {
  let sent;
  await withFetch(async (url, init) => { sent = JSON.parse(init.body); return openAiAnswer(brief()); },
    () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION));
  assert.match(sent.instructions, /Intake Triage Rubric — v0\.5/);
  assert.match(sent.input, /=====BEGIN SUBMISSION [0-9a-f-]+=====/);
  assert.ok(sent.input.includes(SUBMISSION));
  assert.equal(sent.store, false);
});

const failures = {
  'no API key': [() => runTriage({}, SUBMISSION), /OPENAI_API_KEY is not set/],
  'HTTP 500': [
    () => withFetch(async () => new Response('{"error":{"code":"server_error"}}', { status: 500 }),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /HTTP 500 \(server_error\)/,
  ],
  'HTTP 401': [
    () => withFetch(async () => new Response('{"error":{"code":"invalid_api_key"}}', { status: 401 }),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /HTTP 401 \(invalid_api_key\)/,
  ],
  'an HTML error page': [
    () => withFetch(async () => new Response('<html>Bad gateway</html>', { status: 200 }),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /not JSON/,
  ],
  'a network error': [
    () => withFetch(async () => { throw new TypeError('fetch failed'); },
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /could not reach OpenAI/,
  ],
  'a timeout': [
    () => withFetch(
      (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION, { timeoutMs: 30 })),
    /did not answer within/,
  ],
  'an incomplete response': [
    () => withFetch(async () => new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), { status: 200 }),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /incomplete.*max_output_tokens/,
  ],
  'a refusal': [
    () => withFetch(async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), { status: 200 }),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /refused/,
  ],
  'an empty answer': [
    () => withFetch(async () => new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200 }),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /no text/,
  ],
  'an answer that is not a brief': [
    () => withFetch(async () => openAiAnswer('Sure! Here is a friendly reply to the client.'),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /SUBJECT/,
  ],
  'an answer with an unknown verdict': [
    () => withFetch(async () => openAiAnswer(brief().replace('VERDICT:        FREE_SUFFICIENT', 'VERDICT:        PAID_EVERYTHING')),
      () => runTriage({ OPENAI_API_KEY: 'k' }, SUBMISSION)),
    /VERDICT/,
  ],
};

for (const [name, [run, reason]] of Object.entries(failures)) {
  test(`runTriage never throws: ${name}`, async () => {
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.reason, reason);
  });
}
