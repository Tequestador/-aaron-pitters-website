# AaronPitters.com — project notes for Claude Code

## What this repo is

The personal site of Aaron Pitters — author, founder of STORiCORE.
Stack: Replit → GitHub → Cloudflare Pages.

**Current shape:** a single `index.html` at the root (~13KB) plus favicons and a
webmanifest. It is a one-page site with six hash-routed sections — home, about, books,
storicore, blog, contact — shown and hidden by a small inline script at the bottom of the
file. There is no build step, no framework, no `functions/` directory, no `_headers` file
and no `.gitignore`.

**Styling:** Tailwind via `cdn.tailwindcss.com`, plus Inter from Google Fonts, plus a block
of custom CSS in a `<style>` tag in the head. Dark theme — `#111827` background, `#d1d5db`
body text, blue-500 accents, `.btn` and `.btn-secondary` classes defined in that style
block.

## Current work

Adding an AI intake form. Read `docs/build-spec.md` and `docs/project-context.md` before
starting. The spec is the specification — follow it rather than redesigning. The context
document explains which obvious improvements were considered and rejected.

## Hard constraints

**The new page is a separate file at `/ai-help/index.html`,** not a seventh hash section in
the root `index.html`. It needs a real shareable URL, and the single-page file should not
grow to absorb a form. Cloudflare Pages serves `/ai-help/index.html` at `/ai-help`
automatically.

**Match the existing site's look** — same dark palette, same Tailwind classes, same Inter
font, same header and footer markup — so the page doesn't read as bolted on. Reuse the
`.btn` styles.

**Content Security Policy: status unknown.** There is no CSP in this repo — no meta tag,
no `_headers` file. If one exists it is set in the Cloudflare dashboard, which is not
visible from here. Turnstile loads a script from `challenges.cloudflare.com` and fails
*silently* when blocked, so verify the widget actually renders on a throwaway page before
building anything on top of it. Do not assume a CSP problem exists, and do not assume one
doesn't.

**No secrets in the repo.** API keys live in Cloudflare Pages encrypted environment
variables, set by Aaron in the dashboard. Local development uses `.dev.vars`. There is no
`.gitignore` yet — create one, and put `.dev.vars` and the generated rubric module in it
before the first commit that could touch either. Never write a key into a file, a comment,
or an example. If a key is needed and absent, stop and say so.

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
