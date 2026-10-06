// POST /api/intake — the AI Consulting form's backend (Cloudflare Pages Function).
//
// Flow (docs/build-spec.md §5):
//   1. Validate the submission and verify Turnstile.
//   2. AWAIT the raw submission emailed to Aaron ("[New lead] ... triage to follow"). If
//      this fails the visitor is told. If it works, the lead can no longer be lost.
//   3. Answer the visitor right away ("Got it").
//   4. In the background (context.waitUntil): the confirmation email to the visitor and the
//      AI triage (see _triage.js) start at the same time, then the brief goes to Aaron. If
//      the AI step fails, a short [TRIAGE FAILED] email says why.
//
// Why this order: the visitor used to wait ~10 seconds for the AI. Worse, Cloudflare only
// keeps waitUntil work alive for 30 seconds after the response is sent or the visitor
// closes the tab, and the old AI timeout was 40. A slow AI plus a closed tab could have
// killed the function before either the brief or the failure email went out. Now the raw
// submission is safe before the visitor sees success, and everything after it fits inside
// 30 seconds with room to spare (see BACKGROUND_BUDGET_MS).

import { runTriage } from './_triage.js';

// Shown to people when something goes wrong. Same address the page itself uses.
const FALLBACK_EMAIL = 'contact@storicore.com';

// Largest legitimate body is ~16,500 characters of text. Percent-encoding (form posts) can
// inflate that several times over, so this is generous, but still far below "abuse".
const MAX_BODY_BYTES = 128 * 1024;

// Don't let a slow third party hold the request open. This is for the calls the visitor is
// waiting on (Turnstile, and the raw-submission email).
const FETCH_TIMEOUT_MS = 10000;

// Cloudflare stops waitUntil work 30 seconds after the response (docs: Workers > Context,
// "waitUntil"; the limit is shared by every waitUntil call on the request). The background
// chain is budgeted to end by 27.5, leaving 2.5 seconds of margin:
//   confirmation email and triage start together at 0s
//   triage (<= 24s), then the brief or the failure note (each <= 3.5s, and never more than
//   the time left)
// The confirmation runs alongside triage, not before it, so triage gets nearly the whole
// budget instead of whatever a slow email send left over. Resend normally answers in about a
// second, so the sends are cut off at 3.5.
const BACKGROUND_BUDGET_MS = 27500;
const BACKGROUND_SEND_TIMEOUT_MS = 3500;
const TRIAGE_TIMEOUT_MS = BACKGROUND_BUDGET_MS - BACKGROUND_SEND_TIMEOUT_MS; // 24s
// Below this much time left, a send could not finish; skip it rather than overrun.
const MIN_SEND_MS = 500;

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND_URL = 'https://api.resend.com/emails';

// Field caps come from build-spec §4. Labels are used in error messages and in the emails.
const FIELDS = [
  { key: 'name',     label: 'Name',                                         max: 100,  required: true },
  { key: 'email',    label: 'Email',                                        max: 200,  required: true },
  { key: 'business', label: 'What do you do?',                              max: 200,  required: false },
  { key: 'q1',       label: '1. What made you contact me?',                 max: 4000, required: true },
  { key: 'q2',       label: '2. How are you doing it now?',                 max: 4000, required: false },
  { key: 'q3',       label: '3. What would you like to make easier?',       max: 4000, required: true },
  { key: 'q4',       label: '4. What kind of help are you hoping for?',     max: 4000, required: false },
];

// One address only. Excluding commas, semicolons, quotes and angle brackets matters: the
// confirmation email is sent to whatever the visitor typed, and "a@x.com,b@y.com" or
// "Name <a@x.com>" must not turn this form into a way to mail other people.
const EMAIL_PATTERN = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

// An error whose message is safe and useful to show to the visitor.
class IntakeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleIntake(request, env, context);
  } catch (err) {
    if (err instanceof IntakeError) return errorResponse(err.status, err.message, request);
    // Anything else is our bug. Log it, and still answer with something readable, never a bare 500.
    console.error('intake: unexpected error:', err && err.message);
    return errorResponse(500, 'Something went wrong on my end.', request);
  }
}

async function handleIntake(request, env, context) {
  // 1. Method and content type
  if (request.method !== 'POST') {
    throw new IntakeError(405, 'This address only accepts form submissions.');
  }

  const kind = requestKind(request);
  if (!kind) {
    throw new IntakeError(415, 'Unsupported content type.');
  }

  // A missing setting is our problem, not the visitor's, and we'd rather find out on the
  // first test than after a lead arrives. Log names only, never values.
  const missing = ['RESEND_API_KEY', 'TURNSTILE_SECRET_KEY', 'NOTIFY_EMAIL', 'FROM_EMAIL']
    .filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error('intake: missing environment variables:', missing.join(', '));
    throw new IntakeError(500, "This form isn't fully set up yet.");
  }

  // 2. Validate. Oversize bodies are refused before anything that costs money or time.
  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength > MAX_BODY_BYTES) {
    throw new IntakeError(413, 'That submission is too large.');
  }
  const raw = parseBody(await readBodyLimited(request, MAX_BODY_BYTES), kind);
  const submission = validate(raw);

  // 3. Turnstile. The widget puts its token in a field named cf-turnstile-response, on both
  // the JavaScript path and the no-JavaScript path.
  const token = typeof raw['cf-turnstile-response'] === 'string' ? raw['cf-turnstile-response'] : '';
  if (!token) {
    throw new IntakeError(400, 'Please wait for the spam check to finish loading, then try again.');
  }
  const human = await verifyTurnstile(token, request.headers.get('CF-Connecting-IP'), env.TURNSTILE_SECRET_KEY);
  if (!human) {
    throw new IntakeError(400, "The spam check didn't pass. Please reload the page and try again.");
  }

  // 4. The raw submission to Aaron, awaited. This is the guarantee that no lead is lost: it
  // has reached Aaron before the visitor ever sees a success message. If it can't be sent,
  // the visitor is told (and pointed at a direct email address) instead of being lied to.
  const submissionText = formatSubmission(submission);
  try {
    await sendEmail(env, {
      to: env.NOTIFY_EMAIL,
      subject: `[New lead] ${shortName(submission.name)} — triage to follow`,
      text: rawSubmissionEmail(submissionText),
    });
  } catch (err) {
    console.error('intake: could not email the raw submission to NOTIFY_EMAIL:', err.message);
    throw new IntakeError(502, "I couldn't deliver your message to me.");
  }

  // 5. Everything else happens after the visitor has been answered. Called as
  // context.waitUntil, never pulled out into a variable: on Workers it has to be called on
  // the object it belongs to. Without waitUntil (not expected on Pages) we wait instead,
  // which is slower but still never drops the work.
  const background = runBackground(env, submission, submissionText);
  if (context.waitUntil) {
    context.waitUntil(background);
  } else {
    await background;
  }

  // 6. Done.
  if (kind === 'form') {
    return Response.redirect(new URL('/ai-consulting/?sent=1', request.url).toString(), 303);
  }
  return json({ ok: true }, 200);
}

// The work that happens after the visitor has their answer. Never throws: by now the lead
// is safe, and there is nobody left to tell about an error except the logs.
async function runBackground(env, submission, submissionText) {
  try {
    const startedAt = Date.now();
    const msLeft = () => BACKGROUND_BUDGET_MS - (Date.now() - startedAt);
    // A send is given up to BACKGROUND_SEND_TIMEOUT_MS, but never more than what is left, so
    // the chain can't run past the budget. Returns false (sending nothing) if no time is left.
    const sendWithinBudget = async (email) => {
      const timeoutMs = Math.min(BACKGROUND_SEND_TIMEOUT_MS, msLeft());
      if (timeoutMs < MIN_SEND_MS) {
        console.error('intake: no time left in the background budget to send:', email.subject);
        return false;
      }
      await sendEmail(env, { ...email, timeoutMs });
      return true;
    };

    // a. Confirmation to the submitter, started now and awaited at the end, so it runs
    // alongside triage. Its own try/catch: a bounce here changes nothing about the lead,
    // which Aaron already has. reply_to is NOTIFY_EMAIL because FROM_EMAIL is send-only, with
    // no mailbox behind it; without it, a client who hits reply to add a detail sends it
    // nowhere and nobody finds out.
    const confirmation = sendEmail(env, {
      to: submission.email,
      replyTo: env.NOTIFY_EMAIL,
      subject: 'I got your AI Consulting request',
      text: confirmationEmail(submission, submissionText),
      timeoutMs: BACKGROUND_SEND_TIMEOUT_MS,
    }).catch((err) => {
      console.error('intake: confirmation email failed:', err.message);
    });

    // b. The AI step. Never throws; either a brief or a reason there isn't one.
    const triage = await runTriage(env, submissionText, { timeoutMs: TRIAGE_TIMEOUT_MS });

    // c. The brief to Aaron.
    let failure = triage.ok ? null : triage.reason;
    if (triage.ok) {
      try {
        await sendWithinBudget({ to: env.NOTIFY_EMAIL, subject: triage.subject, text: triage.text });
      } catch (err) {
        // A brief that can't be sent is as good as a triage that failed: Aaron was told
        // "triage to follow", so he needs to hear that it isn't coming.
        console.error('intake: could not email the brief to NOTIFY_EMAIL:', err.message);
        failure = `the brief was written but the email carrying it could not be sent (${err.message.slice(0, 100)})`;
      }
    }

    // d. Tell Aaron the brief isn't coming, and that nothing is lost.
    if (failure) {
      try {
        await sendWithinBudget({
          to: env.NOTIFY_EMAIL,
          subject: `[TRIAGE FAILED] ${oneLine(submission.name, 60)}`,
          text: triageFailedEmail(failure, triage.statsLine),
        });
      } catch (err) {
        // Nothing more to try. Aaron still has the "[New lead]" email with everything in it.
        console.error('intake: could not send the [TRIAGE FAILED] email:', err.message);
      }
    }

    await confirmation; // already finished in nearly every case; it never rejects
  } catch (err) {
    console.error('intake: unexpected error in the background step:', err && err.message);
  }
}

// ── Request parsing ──────────────────────────────────────────────────────────────────────

// 'json' (the JavaScript path), 'form' (the no-JavaScript path), or null.
function requestKind(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (type.startsWith('application/json')) return 'json';
  if (type.startsWith('application/x-www-form-urlencoded')) return 'form';
  return null;
}

// Content-Length can be missing or wrong, so count the bytes as they actually arrive.
async function readBodyLimited(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new IntakeError(413, 'That submission is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseBody(text, kind) {
  if (kind === 'form') {
    return Object.fromEntries(new URLSearchParams(text));
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new IntakeError(400, "That submission couldn't be read.");
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new IntakeError(400, "That submission couldn't be read.");
  }
  return data;
}

// Returns a clean object holding only the known fields, trimmed. Anything else in the
// request (including the Turnstile token) is deliberately left out of what gets emailed.
function validate(raw) {
  const clean = {};
  for (const field of FIELDS) {
    const value = raw[field.key];
    if (value !== undefined && typeof value !== 'string') {
      throw new IntakeError(400, `${field.label} isn't in a form I can read.`);
    }
    const text = (value || '').trim();
    if (field.required && text === '') {
      throw new IntakeError(400, `Please fill in: ${field.label}`);
    }
    if (text.length > field.max) {
      throw new IntakeError(400, `"${field.label}" is too long (the limit is ${field.max} characters).`);
    }
    clean[field.key] = text;
  }
  if (!EMAIL_PATTERN.test(clean.email)) {
    throw new IntakeError(400, "That email address doesn't look right.");
  }
  return clean;
}

// ── Third-party calls ────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyTurnstile(token, ip, secret) {
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const response = await fetchWithTimeout(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    const result = await response.json();
    return result.success === true;
  } catch (err) {
    // We couldn't ask Cloudflare at all. Fail closed (an unchecked form invites spam), but
    // say it's a temporary problem rather than blaming the visitor.
    console.error('intake: Turnstile verification request failed:', err.message);
    throw new IntakeError(503, "I couldn't run the spam check just now.");
  }
}

async function sendEmail(env, { to, subject, text, replyTo, timeoutMs }) {
  const payload = { from: env.FROM_EMAIL, to: [to], subject, text };
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetchWithTimeout(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, timeoutMs);
  if (!response.ok) {
    // Resend's error body says what's wrong (unverified domain, bad address, ...).
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend responded ${response.status}: ${detail.slice(0, 300)}`);
  }
}

// ── Email text ───────────────────────────────────────────────────────────────────────────

// The visitor's words as plain text, in one place so the model, the raw-submission email
// and the confirmation all see exactly the same thing. Plain text on purpose: nothing a
// visitor types can be interpreted as markup.
function formatSubmission(submission) {
  const answers = FIELDS
    .filter((f) => f.key.startsWith('q'))
    .map((f) => `${f.label}\n${submission[f.key] || '(no answer)'}`)
    .join('\n\n');
  return [
    `Name:     ${submission.name}`,
    `Email:    ${submission.email}`,
    `Business: ${submission.business || '(not given)'}`,
    '',
    answers,
  ].join('\n');
}

// The first email Aaron gets for every valid submission, sent before the visitor sees
// "Got it". It is the system of record: if everything after it fails, this is enough.
function rawSubmissionEmail(submissionText) {
  return [
    'New AI Consulting submission. The AI triage is running now.',
    'A "[Triage]" brief should follow within a minute or so, or a "[TRIAGE FAILED]" note',
    'if the AI step breaks. If neither arrives, nothing is lost: everything the visitor',
    'submitted is below. Read it yourself and reply to them directly.',
    '',
    `Received: ${new Date().toISOString()}`,
    '',
    '--- SUBMISSION (verbatim) ---',
    submissionText,
    '',
  ].join('\n');
}

// What Aaron gets when no brief is coming. Short on purpose: the raw submission already
// reached him in the "[New lead]" email, so this only says why the AI step didn't deliver.
// The reason is there so he can tell a bad key from a slow model.
function triageFailedEmail(reason, statsLine) {
  return [
    '[TRIAGE FAILED] The AI step did not produce a brief for this submission.',
    `Reason: ${reason}`,
    statsLine,
    '',
    'Nothing is lost: the raw submission already arrived in the "[New lead]" email for this',
    'person. Read it yourself and reply to them directly.',
    '',
    `Time: ${new Date().toISOString()}`,
    '',
  ].join('\n');
}

function confirmationEmail(submission, submissionText) {
  return [
    `Hi ${oneLine(submission.name, 100)},`,
    '',
    "Thanks for writing. I've got your request and you'll hear back from me within one business day.",
    '',
    "Here's a copy of what you sent, for your records:",
    '',
    '----------------------------------------',
    '',
    submissionText,
    '',
    '----------------------------------------',
    '',
    'If you want to add something, just reply to this email. It comes straight to me.',
    '',
    'Aaron Pitters',
    '',
  ].join('\n');
}

// Subjects and greetings are single lines; collapse anything a visitor might have put in
// them (line breaks in particular) and keep them short.
function oneLine(text, maxLength) {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// "Dana L" for "Dana Lee": the form the rubric uses for the Triage subject, so the "[New
// lead]" and "[Triage]" emails for one person are easy to match up in the inbox.
function shortName(fullName) {
  const words = oneLine(fullName, 100).split(' ').filter(Boolean);
  if (words.length === 0) return 'Unknown';
  if (words.length === 1) return words[0].slice(0, 30);
  return `${words[0].slice(0, 30)} ${words[words.length - 1].charAt(0).toUpperCase()}`;
}

// ── Responses ────────────────────────────────────────────────────────────────────────────

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// JSON callers (the page's JavaScript) get JSON; a plain form post gets a small readable
// page, because the browser has navigated away from the form and needs something to show.
function errorResponse(status, message, request) {
  const headers = status === 405 ? { Allow: 'POST' } : {};

  if (requestKind(request) !== 'form') {
    return json({ ok: false, error: message, contact: FALLBACK_EMAIL }, status, headers);
  }

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Message not sent - Aaron Pitters</title>
<style>
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         background: #111827; color: #d1d5db; margin: 0; padding: 4rem 1rem; line-height: 1.5; }
  main { max-width: 36rem; margin: 0 auto; }
  h1 { color: #fff; font-size: 1.875rem; margin: 0 0 1rem; }
  p { font-size: 1.125rem; margin: 0 0 1rem; }
  a { color: #60a5fa; }
</style>
</head>
<body>
<main>
<h1>Your message wasn't sent</h1>
<p>${escapeHtml(message)}</p>
<p>You can go <a href="/ai-consulting/">back to the form</a>, or email me directly at <a href="mailto:${FALLBACK_EMAIL}">${FALLBACK_EMAIL}</a> and I'll pick it up from there.</p>
</main>
</body>
</html>`;
  return new Response(page, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
  });
}
