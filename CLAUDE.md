# AaronPitters.com — project notes for Claude Code

## What this repo is

The personal site of Aaron Pitters — author, founder of STORiCORE.
Stack: Replit → GitHub → Cloudflare Pages.

**Branches:** `replit-version` is the production branch — it is the only branch Cloudflare
Pages deploys to aaronpitters.com. `main` is an old snapshot from before the Replit
rewrite of `index.html`; do not treat it as current and do not base work on it. All work
lands on `replit-version`, either pushed directly or through a pull request into it.
(The intake docs, rubric and tests were first committed on `main` and were merged into
`replit-version`.)

**Current shape:** a single `index.html` at the root plus favicons, a webmanifest, and
Replit leftovers (`.replit`, `replit.md`, `server.py` — they only serve the site inside
Replit and do nothing on Cloudflare Pages). It is a one-page site with six hash-routed
sections — home, about, books, storicore, blog, contact — shown and hidden by a small
inline script at the bottom of the file, with a hamburger menu below 768px. There is no
framework. There is one build command, `node scripts/build-prompt.mjs`, set in the
Cloudflare Pages dashboard, which generates the rubric module. The intake function lives in
`functions/api/intake.js` (validation, Turnstile, the triage step, the brief or
`[TRIAGE FAILED]` email to Aaron, the confirmation email to the submitter), with the OpenAI
call and brief-building in `functions/api/_triage.js`. The model name is one constant,
`OPENAI_MODEL`, at the top of that file.

**Styling:** all inline. The live site uses one `<style>` block in the head with plain
hand-written CSS and semantic class names (`.site-header`, `.nav-link`, `.btn`,
`.btn-secondary`, `.site-footer`, …). It does **not** use Tailwind and does **not** load
Google Fonts — the font stack is `Inter, -apple-system, …` and falls back to the system
font. (Older copies of this repo, and the first version of the spec, describe a Tailwind
CDN site; that was replaced.) Dark theme — `#111827` background, `#d1d5db` body text,
blue-500 accents.

## Current work

Adding an AI intake form. Read `docs/build-spec.md` and `docs/project-context.md` before
starting. The spec is the specification — follow it rather than redesigning. The context
document explains which obvious improvements were considered and rejected.

## Hard constraints

**The new page is a separate file at `/ai-consulting/index.html`,** not a seventh hash section in
the root `index.html`. It needs a real shareable URL, and the single-page file should not
grow to absorb a form. Cloudflare Pages serves `/ai-consulting/index.html` at `/ai-consulting`
automatically.

**Match the existing site's look** — same dark palette, same inline CSS approach (copy the
relevant rules from the root `index.html`'s `<style>` block; no Tailwind, no Google
Fonts), same header and footer markup — so the page doesn't read as bolted on. Reuse the
`.btn` styles. `ai-consulting/index.html` already does this; keep it in step if the root page's
styles change.

**Content Security Policy: it lives in the Cloudflare dashboard, not in this repo.** The
site's CSP is set by a Response Header Transform Rule named **"Static Site CSP"** on the
aaronpitters.com zone (Cloudflare dashboard → Rules → Transform Rules → Modify Response
Header). Nothing in the repo sets one: there is no `_headers` file and no meta tag. (A
`_headers` file with a CSP was added in commit `1d5e88c` and removed in `7057995`; the
dashboard rule is what actually applied to the live site.)

That rule originally blocked Turnstile, which was the blocker when `/ai-consulting` first went
live. Aaron fixed it in the dashboard: `https://challenges.cloudflare.com` is now in the
rule's `script-src`, and `frame-src https://challenges.cloudflare.com` was added. Turnstile
needs both, because it loads a script and renders in an iframe. The form works end to end
with the rule as it stands.

**Any new external script, stylesheet, font, frame or network destination the site starts
using must be added to that dashboard rule**, or it will fail in production while working
locally. It fails silently in the browser console, not in the page. That includes Google
Fonts or a CDN if they ever come back, and anything the function's front end calls other
than `/api/intake` (server-side calls to Resend, Turnstile and OpenAI from the function are
not affected by the browser's CSP). Claude cannot see or edit the rule from here, so when a
change needs a CSP edit, say so plainly and tell Aaron exactly which directive and origin
to add. If the rule is ever moved into the repo (`_headers`), it must keep the Turnstile
entries above. After any header change, confirm the widget actually renders. Do not assume
a CSP problem exists, and do not assume one doesn't.

**No secrets in the repo.** API keys live in Cloudflare Pages encrypted environment
variables, set by Aaron in the dashboard. Local development uses `.dev.vars`. `.gitignore`
already existed (Python and OS entries from the Replit setup); the intake work appended
`.dev.vars`, `functions/api/_rubric.generated.js` and `node_modules/` to it rather than
replacing it — keep it that way. Never write a key into a file, a comment, or an example.
If a key is needed and absent, stop and say so.

**No database.** Email is the system of record. Do not add KV, D1, R2, or any store.

**No dashboard, no login, no payment processing, no scheduling.** If a feature seems
obviously missing, it was deliberately excluded — check `docs/build-spec.md` §8 and
`docs/project-context.md` before proposing it.

## The non-negotiable behavior

If the OpenAI API call fails, times out, or returns something unparseable, the function
**must still email Aaron the raw submission** with `[TRIAGE FAILED]` in the subject.

A lead is never lost because the AI step broke. The premise of this system is that AI
saves Aaron time, not that it stands between him and a prospective client. Write this path
at the same time as the happy path, never afterward.

## The rubric

`prompts/triage-rubric.md` is the triage prompt and the single source of truth. It is
edited by a human, in English, and read by people as well as by the model.

`scripts/build-prompt.mjs` generates `functions/api/_rubric.generated.js` from it at build
time, because Pages Functions cannot read markdown off disk at runtime. The generated file
is gitignored. Never edit the generated file, and never hand-copy rubric text into a
JavaScript module — the drift is the bug.

Do not "improve," summarize, or restructure the rubric's content. Its wording is the result
of a long set of decisions and some of its constraints exist for reasons the text doesn't
explain.

## Working style

Aaron is a writer and a solopreneur, not a full-time engineer. He reads and understands
everything that goes in, so:

- Prefer boring, legible code over clever code.
- Comment the *why*, not the *what*.
- Small commits with clear messages.
- When a decision is genuinely open, ask rather than guessing — but don't ask about
  anything `docs/build-spec.md` already settles.
- Never add a dependency without saying why a dependency is needed at all.
- Do not refactor the existing `index.html` as a side effect of this work. If something in
  it looks wrong, say so and leave it alone.

## Testing

`tests/test-leads.md` holds ten sample submissions and an answer key.

Lead 7 is a prompt-injection attempt. The deployed system must return a DECLINE, write no
draft replies, and never reproduce any part of the rubric in its output. Treat that as a
test that must pass, not an edge case.

Automated tests (Node's built-in runner, no packages) live in `tests/*.test.mjs`. Run them
with `node scripts/build-prompt.mjs && node --test tests/*.test.mjs`. The build step comes first
because `_triage.js` imports the generated rubric module. They cover the brief email (the
My take guard, the verbatim submission, TOOLS TO RESEARCH) and the intake function (including
the `[TRIAGE FAILED]` fallback) with a fake network, so they never call OpenAI or send mail.
They do not replace the ten sample leads, which need the real model.

The full checklist is in `docs/build-spec.md` §9.
