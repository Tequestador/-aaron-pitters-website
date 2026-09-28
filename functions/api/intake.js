// POST /api/intake — the AI Help form's backend (Cloudflare Pages Function).
//
// Current stage (docs/build-spec.md §11 step 5): validate, verify Turnstile, email Aaron the
// raw submission, email the submitter a confirmation. There is no OpenAI call yet; when it is
// added (step 6) it slots in between "verify Turnstile" and "email Aaron", and the raw-email
// path below becomes the [TRIAGE FAILED] fallback.
//
// The one rule: a valid submission must never vanish. If Aaron's email can't be sent, we say
// so to the submitter (who is then pointed at a direct email address) instead of pretending.

// Shown to people when something goes wrong. Same address the page itself uses.
const FALLBACK_EMAIL = 'contact@storicore.com';

// Largest legitimate body is ~16,500 characters of text. Percent-encoding (form posts) can
// inflate that several times over, so this is generous, but still far below "abuse".
const MAX_BODY_BYTES = 128 * 1024;

// Don't let a slow third party hold the request open.
const FETCH_TIMEOUT_MS = 10000;

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

export async function onRequest({ request, env }) {
  try {
    return await handleIntake(request, env);
  } catch (err) {
    if (err instanceof IntakeError) return errorResponse(err.status, err.message, request);
    // Anything else is our bug. Log it, and still answer with something readable, never a bare 500.
    console.error('intake: unexpected error:', err && err.message);
    return errorResponse(500, 'Something went wrong on my end.', request);
  }
}

async function handleIntake(request, env) {
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

  // 4–5. (OpenAI triage goes here in step 6.)

  // 6/7. Email Aaron. This is the email that matters: if it fails, the lead is lost, so the
  // visitor must be told.
  try {
    await sendEmail(env, {
      to: env.NOTIFY_EMAIL,
      subject: `[AI Help] New submission from ${oneLine(submission.name, 60)}`,
      text: rawSubmissionEmail(submission),
    });
  } catch (err) {
    console.error('intake: could not email the submission to NOTIFY_EMAIL:', err.message);
    throw new IntakeError(502, "I couldn't deliver your message to me.");
  }

  // 8. Confirmation to the submitter, in its own try/catch: a bounce here must not turn a
  // delivered lead into an error. It is deliberately not attempted when the email above
  // failed, since "I got your message" would then be false.
  let confirmationSent = true;
  try {
    await sendEmail(env, {
      to: submission.email,
      // FROM_EMAIL is send-only, with no mailbox behind it. Without reply_to, a client who
      // hits reply to add a detail sends it nowhere and nobody finds out.
      replyTo: env.NOTIFY_EMAIL,
      subject: 'I got your AI Help request',
      text: confirmationEmail(submission),
    });
  } catch (err) {
    confirmationSent = false;
    console.error('intake: confirmation email failed:', err.message);
  }

  // 9. Done.
  if (kind === 'form') {
    return Response.redirect(new URL('/ai-help/?sent=1', request.url).toString(), 303);
  }
  return json({ ok: true, confirmationSent }, 200);
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

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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

async function sendEmail(env, { to, subject, text, replyTo }) {
  const payload = { from: env.FROM_EMAIL, to: [to], subject, text };
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetchWithTimeout(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // Resend's error body says what's wrong (unverified domain, bad address, ...).
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend responded ${response.status}: ${detail.slice(0, 300)}`);
  }
}

// ── Email text ───────────────────────────────────────────────────────────────────────────

// Plain text on purpose: nothing a visitor types can be interpreted as markup.
function answersBlock(submission) {
  return FIELDS
    .filter((f) => f.key.startsWith('q'))
    .map((f) => `${f.label}\n${submission[f.key] || '(no answer)'}`)
    .join('\n\n');
}

function rawSubmissionEmail(submission) {
  return [
    'New submission from the AI Help form.',
    'AI triage is not connected yet, so this is the raw submission.',
    '',
    `Name:     ${submission.name}`,
    `Email:    ${submission.email}`,
    `Business: ${submission.business || '(not given)'}`,
    `Received: ${new Date().toISOString()}`,
    '',
    '----------------------------------------',
    '',
    answersBlock(submission),
    '',
  ].join('\n');
}

function confirmationEmail(submission) {
  return [
    `Hi ${oneLine(submission.name, 100)},`,
    '',
    "Thanks for writing. I've got your request and you'll hear back from me within one business day.",
    '',
    "Here's a copy of what you sent, for your records:",
    '',
    '----------------------------------------',
    '',
    answersBlock(submission),
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
<p>You can go <a href="/ai-help/">back to the form</a>, or email me directly at <a href="mailto:${FALLBACK_EMAIL}">${FALLBACK_EMAIL}</a> and I'll pick it up from there.</p>
</main>
</body>
</html>`;
  return new Response(page, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
  });
}
