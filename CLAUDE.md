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
build step, no framework, and no `functions/` directory yet.

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

**The new page is a separate file at `/ai-help/index.html`,** not a seventh hash section in
the root `index.html`. It needs a real shareable URL, and the single-page file should not
grow to absorb a form. Cloudflare Pages serves `/ai-help/index.html` at `/ai-help`
automatically.

**Match the existing site's look** — same dark palette, same inline CSS approach (copy the
relevant rules from the root `index.html`'s `<style>` block; no Tailwind, no Google
Fonts), same header and footer markup — so the page doesn't read as bolted on. Reuse the
`.btn` styles. `ai-help/index.html` already does this; keep it in step if the root page's
styles change.

**Content Security Policy: none in the repo now, but one was here once.** A `_headers` file
with a CSP (`default-src 'self'; script-src 'self' 'unsafe-inline'
https://cdn.tailwindcss.com; …`) was added in commit `1d5e88c` and removed again in
`7057995`. That policy did not allow Turnstile. There is currently no `_headers` file, no
meta tag, and nothing in the repo that sets a CSP. Whether one is set in the Cloudflare
dashboard is not visible from here. **If a CSP is ever re-added** (in `_headers`, a meta
tag, or the dashboard), it must allow `https://challenges.cloudflare.com` in **both**
`script-src` and `frame-src`, because Turnstile loads a script and renders in an iframe.
It also needs `connect-src 'self'` for the form's POST to `/api/intake`. Turnstile fails
*silently* when blocked, so after any header change confirm the widget actually renders.
Do not assume a CSP problem exists, and do not assume one doesn't.

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

The full checklist is in `docs/build-spec.md` §9.
