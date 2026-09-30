# Launch checklist — AI Consulting intake

Ordered so that nothing is blocked waiting on something else, and so the site is never in
a broken state. Roughly an hour of your own time spread across it, plus the Claude Code
session.

**Gate:** the ten test leads should be run against the rubric before the function goes
live. Part E can be built in parallel, but don't announce the page until the rubric has
been through the test set and revised.

---

## Part A — Accounts and keys (you, ~30 minutes, do this first)

DNS propagation is the only thing here with a waiting period, so start it immediately.

**A1. Resend.** Create an account at resend.com. Add `aaronpitters.com` as a sending
domain. It gives you DNS records — add them in your Cloudflare DNS for the domain. Wait
for the domain to show as verified.

- Sending address: something like `ai@aaronpitters.com`. You do **not** need a mailbox
  for it — Resend only sends.
- Set the reply-to on the confirmation email to an address you actually read, so someone
  hitting reply reaches you rather than a void.

**A2. Turnstile.** Cloudflare dashboard → Turnstile → add a widget.

- Domains: `aaronpitters.com`, and add `localhost` if you want to test locally.
- Save both keys. The **site key** is public and goes in the page. The **secret key** is
  not and goes in the environment variables.

**A3. OpenAI API key.** platform.openai.com → API keys → create a new key named for this
project, so you can revoke it independently of anything else you run. If your account uses
projects, put it in its own project and set a monthly spending limit there — a small cap
makes a runaway bug cost dollars, not your balance.

**A4. Decide the notification address** — where the briefs land. Your everyday inbox is
right; you want these on your phone.

---

## Part B — Documents into the repo (you, ~10 minutes)

Do this before any code exists. A repo where the spec, rubric, and test set are committed
*first* tells a different story than one where documentation appears at the end, and git
history makes that visible to anyone who looks.

**B1.** Clone the repo locally if you haven't, and work on **`replit-version`**:

```
git clone https://github.com/Tequestador/-aaron-pitters-website.git
git checkout replit-version
```

`replit-version` is the production branch — the only one Cloudflare Pages deploys to
aaronpitters.com. `main` is an old snapshot from before the Replit rewrite of `index.html`;
don't base anything on it. Every commit in this checklist goes to `replit-version`, either
pushed directly or through a pull request into it.

**B2. Append to the existing `.gitignore`, before anything else.** The file already exists
(Python and OS entries from the Replit setup, including `.DS_Store`) — add to it, don't
replace it. Add these lines at the end:

```
.dev.vars
functions/api/_rubric.generated.js
node_modules/
```

**B3.** Place the files:

| download | goes to |
|---|---|
| `CLAUDE.md` | `CLAUDE.md` (root) |
| `triage-rubric-v0.4.md` | `prompts/triage-rubric.md` |
| `build-spec-v1.md` | `docs/build-spec.md` |
| `project-context.md` | `docs/project-context.md` |
| `test-leads-v1.md` | `tests/test-leads.md` |

Decide before committing whether to keep the last section of `project-context.md` — it
says out loud that this is job-search preparation. Fine in a private repo; your call in a
public one.

**B4.** Commit and push to `replit-version`: `Add intake spec, triage rubric, and test set`

---

## Part C — The page (you, ~20 minutes)

**C1.** Place `ai-consulting-index.html` at `ai-consulting/index.html`.

**C2.** Put your Turnstile site key from A2 in the page (`data-sitekey` on the
`cf-turnstile` div). *Done — the real site key is in `ai-consulting/index.html`.*

**C3.** Do **not** link it from the site nav yet. It goes live unlinked so you can look at
it, and test the form, before anyone else can find it. The nav link is decided (yes) and
goes in only once the form is confirmed working — see G1. *(The form is confirmed working
and the link has been added.)*

**C4.** Commit and push to `replit-version`. Cloudflare Pages deploys automatically. Visit
`aaronpitters.com/ai-consulting`.

**C5. The one thing to verify:** does the Turnstile widget render above the Send button?

- **Yes** → the CSP already allows Turnstile. Move on.
- **No** → the Content Security Policy is blocking `challenges.cloudflare.com`. **The CSP
  is not in the repo.** It is a Response Header Transform Rule named **"Static Site CSP"**
  on the aaronpitters.com zone: Cloudflare dashboard → Rules → Transform Rules → Modify
  Response Header. Turnstile needs both of these in that rule:
  - `https://challenges.cloudflare.com` in `script-src`
  - `frame-src https://challenges.cloudflare.com`

  This is exactly what happened on the first deploy: the widget didn't render because the
  rule allowed neither. Both entries have since been added, and the widget renders and the
  form works end to end.

**Whenever the site later gains a new external script, stylesheet, font, frame or other
browser-side network destination, add it to the "Static Site CSP" rule too.** It will work
locally and fail silently in production otherwise. (The function's own server-side calls to
Resend, Turnstile and OpenAI aren't affected by the browser's CSP.)

At this point the page exists and looks right. Before the function is deployed, submitting
fails and the form tells people to email you directly — which is honest, and nobody can
find the page anyway.

---

## Part D — Environment variables (you, ~5 minutes)

Cloudflare dashboard → Workers & Pages → your project → Settings → Environment variables.
Add all five as **encrypted**, for both Production and Preview:

```
OPENAI_API_KEY
RESEND_API_KEY
TURNSTILE_SECRET_KEY
NOTIFY_EMAIL      where briefs go
FROM_EMAIL        e.g. ai@aaronpitters.com
```

Then create `.dev.vars` locally with the same values for testing. Confirm it's ignored:
`git status` should not list it. If it does, stop and fix `.gitignore` before committing.

**D2. Build command.** The site currently deploys with no build step. The rubric module is
generated at build time, so in the same Settings area set **Build command** to
`node scripts/build-prompt.mjs` and leave the build output directory as it is now (the
repo root). Do this once `scripts/build-prompt.mjs` exists — setting it before the script is
in the repo will fail the next deploy. On the first deploy after, check the build log shows
the script ran.

---

## Part E — The function (Claude Code)

Open Claude Code in the repo. Opening prompt:

> Read CLAUDE.md, docs/build-spec.md, and docs/project-context.md. We're on the
> `replit-version` branch, which is what deploys live. We're building the `/ai-consulting`
> intake. The page is already live at ai-consulting/index.html and the Turnstile widget
> renders. Start at build-spec §11 step 5: the function with validation, Turnstile
> verification, the raw submission emailed to me, and the confirmation email to the
> submitter. No OpenAI API call yet. Stop there so I can deploy and test it.

**E1.** Build and deploy through step 5, **including the confirmation email.** The page's
success message tells people a copy was sent to them — so the confirmation has to exist
from the first working deploy, or the page is making a claim that isn't true. Submit the
form. A raw submission should arrive in your inbox and a confirmation in the test address.
**This is the real milestone** — the form works and no lead can be lost, with no AI
involved. If the week goes sideways, you're still open for business. *(Reached: the form
works end to end on aaronpitters.com/ai-consulting, both emails arrive, and reply-to works.)*

**E2.** Then: the rubric build script, the OpenAI API call, the brief, and the
`[TRIAGE FAILED]` fallback path — written at the same time, not after. Set the build
command (D2) once the script is in the repo.

---

## Part F — Testing (you)

**F1.** Work the checklist in build-spec §9. The two that matter most:

- Break the API key on purpose. Confirm a raw submission still arrives with
  `[TRIAGE FAILED]` in the subject.
- Submit test lead 7 (the injection). Confirm a DECLINE, no draft replies, and no rubric
  text anywhere in the output.

**F2.** Run all ten test leads. **Use a fresh chat with nothing in it but the rubric and
one submission.** If the session has seen the answer key, lead 5 proves nothing — it
already knows MonuTrak is fictional.

**F3.** Revise the rubric based on what you find. Commit it as v0.5 with a note on what
changed and why. That commit is part of the artifact.

---

## Part G — Actually live

**G1.** The nav link is decided: **yes**, "AI Consulting" goes in the main nav as the last item,
after Contact, on both the root `index.html` and `ai-consulting/index.html` (marked as the
current page there), once the form is confirmed working. *(Done. The root page's script now
selects `.nav-link[data-target]`, so it doesn't intercept the new link.)* The nav link is
the only link to the page: the build spec no longer asks for a separate one from the
Contact section.

**G2.** Send the link to two or three people who'll give you a straight reaction to the
page before strangers see it.

**G3.** Write `docs/intake-workflow.md` — what it does, why the human stays in the loop,
the failure modes you found in testing, cost per lead. That's the document that turns this
from a thing you built into a thing you can hand to an interviewer.

---

## If something breaks

- **Widget doesn't render** → the CSP, which lives in the Cloudflare dashboard (the
  "Static Site CSP" Transform Rule), not the repo. See C5.
- **Form submits but nothing arrives** → check the Pages Function logs in the Cloudflare
  dashboard first; they'll usually name it.
- **Email arrives in spam** → Resend domain not fully verified, or DMARC/SPF records
  incomplete. Test from both a Gmail and a non-Gmail address.
- **Brief arrives but formatted wrong** → that's the rubric, not the code. Fix
  `prompts/triage-rubric.md` and redeploy; the build script regenerates the prompt module.
