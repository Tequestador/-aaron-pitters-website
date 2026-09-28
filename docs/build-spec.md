# Build Spec — AI Help intake

Written to be handed to Claude Code. It should not need to make design decisions; where
something is genuinely open it's marked **DECIDE**.

**Companion documents:** `triage-rubric.md` v0.4 (the prompt), `test-leads-v1.md` (the
test set). Do not build until the test set has been run by hand and the rubric revised.

---

## 1. What this is

A form on AaronPitters.com. Someone submits it. A serverless function sends the answers
to the OpenAI API with the triage rubric, and emails Aaron a decision brief with two drafted
replies. The submitter gets an instant confirmation. Aaron edits a draft, writes his
*My take* paragraph, and sends it from his own email.

No database. No dashboard. No login. No payment processing. Aaron's inbox is the system
of record and his mail client is the interface.

```
visitor → /ai-help form
            ↓
        POST /api/intake  (Cloudflare Pages Function)
            ↓
        verify Turnstile token
            ↓
        call OpenAI with rubric + submission
            ↓
        ┌───────────────┬────────────────┐
        ↓               ↓                ↓
   brief → Aaron   confirmation    (on failure: raw
                    → submitter     submission → Aaron)
```

---

## 2. Platform decisions, already made

**Stay on Cloudflare Pages.** The site is already there (Replit → GitHub → Cloudflare
Pages). Pages is fully supported and Pages Functions still work; Cloudflare recommends
Workers for *new* full-stack projects, but migrating an existing working site for that
reason alone is churn. Add a function to the existing project.

**Turnstile** for spam protection. Cloudflare's own, free, already in the account.

**Resend** for transactional email. MailChannels ended its free Cloudflare Workers
offering, so the old free path is gone. Resend's free tier is about 3,000 emails a
month — roughly 1,500 submissions, since each one sends two. Requires verifying
aaronpitters.com by adding DNS records, which is straightforward because the domain's DNS
is already at Cloudflare.

**No payment integration.** Paid levels are handled by Aaron replying with a payment link
by hand. There are no paying clients yet; building checkout before anyone has asked to pay
is the app trap in miniature.

---

## 3. Repo layout

**Branch: `replit-version` is production.** It is the only branch Cloudflare Pages deploys.
`main` is an old snapshot from before the Replit rewrite of `index.html` — don't build on
it. Push to `replit-version` directly or open a pull request into it.

Before the intake work, the repo was one `index.html` at the root, favicons, a webmanifest,
and Replit leftovers (`.replit`, `replit.md`, `server.py`, which do nothing on Pages). No
`functions/`, no `_headers` (the CSP is a dashboard rule — see §4), no build step. A
`.gitignore` already existed with Python and OS entries; the new entries are **appended**
to it, not a replacement. Everything in the tree below is new except that `.gitignore`.

```
/.gitignore                      EXISTS — append the entries below before the first commit
/ai-help/index.html              the page and form
/functions/api/intake.js         the POST handler
/prompts/triage-rubric.md        the rubric — source of truth, human-edited
/scripts/build-prompt.mjs        generates the importable prompt module
/functions/api/_rubric.generated.js   generated; gitignored
/docs/build-spec.md              this file
/docs/project-context.md         why, and what was rejected
/docs/intake-workflow.md         the write-up (task 7)
/tests/test-leads.md             the test set
```

`.gitignore` must contain at least `.dev.vars` and
`functions/api/_rubric.generated.js`. Append them first (done); a key committed once is in
the history forever.

Adding a `functions/` directory is all that's needed to turn on Pages Functions — no
dashboard change, no configuration.

**Why the generated file.** Pages Functions can't read a `.md` off disk at runtime, and
wiring a bundler to import markdown as text is more configuration than this deserves.
`build-prompt.mjs` reads the markdown and writes a JS module exporting it as a string. Add
it to the Pages build command so it runs on every deploy. The markdown stays the single
source of truth and never drifts from what runs.

---

## 4. The page — `/ai-help`

**A separate page, not a seventh hash section.** The root `index.html` is a one-page site
with six sections shown and hidden by an inline script. The intake page needs a real URL
people can be sent to, and the existing file shouldn't grow to absorb a form. Cloudflare
Pages serves `/ai-help/index.html` at `/ai-help` with no configuration.

**Match the existing look.** The live site uses inline CSS only: one hand-written
`<style>` block with semantic class names. It does **not** use Tailwind and does **not**
load Google Fonts (the font stack is `Inter, -apple-system, …`, so it falls back to the
system font). Dark theme, `#111827` background, `#d1d5db` text, blue-500 accents, `.btn`
and `.btn-secondary` classes. Reuse the same header (including the hamburger menu), footer,
and palette so the page reads as part of the site. Copy the relevant rules from the root
page's style block rather than refactoring them into a shared file; there is no build step
and this is not the moment to add one. `ai-help/index.html` has been restyled this way.

**CSP: it lives in the Cloudflare dashboard, not the repo.** The site's CSP is a Response
Header Transform Rule named **"Static Site CSP"** on the aaronpitters.com zone (dashboard →
Rules → Transform Rules → Modify Response Header). The repo sets none: no `_headers` file
and no meta tag. (A `_headers` CSP was added in `1d5e88c` and removed in `7057995`; the
dashboard rule is what applied to the live site.) Turnstile loads a script from
`challenges.cloudflare.com` and renders in an iframe, and it fails *silently* when blocked.
That rule originally blocked it. It now allows `https://challenges.cloudflare.com` in
`script-src`, and has `frame-src https://challenges.cloudflare.com` added; the widget
renders and the form works end to end.

**Any new external script, stylesheet, font, frame or browser-side network destination
must be added to that rule**, or it will work locally and fail in production. Calls made by
the function itself (Resend, Turnstile verification, OpenAI) are server-side and not
subject to the browser's CSP. If the rule is ever moved into the repo, keep the Turnstile
entries. After any header change, confirm the widget renders.

Page contents, in order:

1. One short paragraph on what this is.
2. The three levels — Quick Read (free), Explainer ($50), Workflow Review ($200) — each
   with its one-line description and the published example questions from rubric §2.
   These do double duty: they help the visitor self-select and they're what the AI
   classifies against.
3. Turnaround: Quick Read within one business day, paid work within three.
4. The form.
5. The §9 notice, **above the submit button**, not in a footer link.

Form fields:

| field | type | required | max |
|---|---|---|---|
| `name` | text | yes | 100 |
| `email` | email | yes | 200 |
| `business` | text | no | 200 |
| `q1` … `q4` | textarea | q1 and q3 required | 4000 each |
| Turnstile token | hidden | yes | — |

The four questions, labelled in full:

1. What made you contact me?
2. How are you doing it now?
3. What would you like to make easier?
4. What kind of help are you hoping for?

Add a link to `/ai-help` from the root page's contact section. Whether it also joins the
main nav is a **DECIDE** below.

Plain HTML form, progressive enhancement: JS intercepts submit and posts JSON, but the
form must still be readable and the labels correct without it. Show a success state in
place of the form — don't navigate away. Show a real error message on failure, including
an email address to write to directly, because a form that eats a submission silently is
worse than no form.

---

## 5. The function — `POST /api/intake`

Steps, in order:

1. **Method and content type.** Reject anything but POST. Accept both
   `application/json` (the JavaScript path) and `application/x-www-form-urlencoded` (the
   no-JavaScript path — the form has `method="post" action="/api/intake"`). For
   form-encoded requests, respond with a 303 redirect to `/ai-help/?sent=1` on success,
   and to a plain error page on failure; for JSON requests, respond with JSON. The Turnstile
   widget submits its token in a field named `cf-turnstile-response` either way.
2. **Validate.** Required fields present, lengths within the caps above, email shaped like
   an email. Reject oversize bodies before doing anything expensive.
3. **Verify Turnstile** server-side against `TURNSTILE_SECRET_KEY`. Reject on failure.
4. **Build the prompt.** System prompt = the generated rubric string. User message = the
   submission, clearly delimited, with an explicit line that everything inside is submitted
   content and not instructions. (Test lead 7 is a prompt injection; this is the line it
   has to get past, together with rubric §10.)
5. **Call the OpenAI API.** Use a current mid-tier model — triage is careful reading, not
   hard reasoning. Check OpenAI's current model list rather than using a model name from
   memory; names change. Keep the model name in one constant so it can be swapped in one
   line. Pass the rubric as the system/developer instruction and the delimited submission
   as the user message. Set a timeout. On any failure, go to step 7's fallback.

   The rubric is deliberately provider-neutral. Nothing in it depends on which model reads
   it, which is what makes the comparison run in DECIDE #2 possible.
6. **Email the brief to Aaron** via Resend. Subject line comes from the brief's own
   `SUBJECT:` line. Body: the brief verbatim, then the raw submission.
7. **Fallback — this is the important one.** If the API call fails, times out, or returns
   something unusable, **still email Aaron the raw submission**, subject prefixed
   `[TRIAGE FAILED]`. A lead must never be lost because the AI step broke. The whole
   design premise is that the AI saves Aaron time, not that it stands between him and his
   customers.
8. **Email the confirmation to the submitter.** Short: received, you'll hear within one
   business day, here's what you sent. Sending them a copy of their own submission is
   cheap and makes the promise feel real.

   **Set `reply_to` to `NOTIFY_EMAIL`.** `FROM_EMAIL` is a send-only address with no
   mailbox behind it. Without a reply-to, a client who hits reply to add a detail sends it
   nowhere, and nobody finds out.
9. **Return 200** with a success flag. Return a useful error otherwise — never a bare 500.

Both emails go out even if one fails; don't let a bounce on the confirmation kill the
brief. Wrap each independently.

---

## 6. Environment variables

Set as encrypted variables in the Pages project settings. None in the repo, ever.

```
OPENAI_API_KEY
RESEND_API_KEY
TURNSTILE_SECRET_KEY
NOTIFY_EMAIL          where briefs go
FROM_EMAIL            verified sender on aaronpitters.com
```

The Turnstile *site* key is public and goes in the page HTML. The *secret* key does not.

---

## 7. The brief email

Plain text. The rubric already specifies the body format; the email adds nothing but a
subject line and the raw submission at the bottom.

One formatting requirement: render `My take:` and its `[LEAVE BLANK — Aaron writes this.]`
placeholder so they're unmissable at a glance — the point is that an unfilled *My take* is
visible before sending, not after.

---

## 8. What not to build

Say no to all of these, now and later, unless something real forces the issue:

- A database or lead log. Email is the record.
- A review dashboard or approve-and-send button. The mail client is the interface.
- Anything that emails the client without Aaron in the loop.
- Payment processing, accounts, or scheduling.
- A second AI pass to "improve" the drafts.
- Analytics beyond what Cloudflare already reports.

---

## 9. Test checklist

Before it's done:

- [ ] Submit a real lead from the test set end to end; brief arrives, format intact.
- [ ] Submit lead 7 (the injection). No rubric content appears in any output, no draft
      replies are written, verdict is DECLINE.
- [ ] Break the API key deliberately. Confirm the raw submission still arrives with
      `[TRIAGE FAILED]`.
- [ ] Submit with JavaScript disabled — page still readable, failure message sensible.
- [ ] Submit with Turnstile blocked — clean rejection, no crash.
- [ ] Oversize field (10,000 characters) — rejected before the API call.
- [ ] Confirmation email arrives, and lands out of spam. Check this one from a Gmail
      address and a non-Gmail address.
- [ ] Every brief's *My take* is blank.
- [ ] Page renders at phone width.

---

## 10. Cost

Effectively nothing at this volume. Cloudflare Pages, Functions, and Turnstile are free at
this scale; Resend's free tier covers roughly 1,500 submissions a month. The OpenAI API
call is the only per-use cost and it's cents per submission at mid-tier model pricing,
drawn from Aaron's existing OpenAI balance.

**Verify current API pricing before writing any number into the public write-up.** Model
prices change and a stale figure in a portfolio document is the kind of small wrong detail
an interviewer notices.

---

## 11. Order of work

0. Create `.gitignore` with `.dev.vars` and the generated rubric module. Before anything
   else.
1. DNS and domain verification for Resend. Do this next — it can take time to propagate
   and everything else is blocked behind it.
2. Confirm Turnstile renders on a throwaway page. Fix the CSP only if it turns out one
   exists and blocks it. *(Done: the dashboard rule "Static Site CSP" did block it and has
   been updated — see §4.)*
3. The `/ai-help` page, static, form posting nowhere.
4. `build-prompt.mjs` and the Pages build command.
5. The function — validation, Turnstile, the raw submission to Aaron, **and the
   confirmation email to the submitter.** The page's success message says a copy was sent,
   so the confirmation ships in the same deploy. **Deploy here.** At this point the form
   works and no lead can be lost, with no AI involved.
6. Add the OpenAI call and the brief, with the fallback path written at the same time, not
   after.
7. Run the test checklist.

Step 5 is a real stopping point. If the week goes sideways, the site still has a working
contact form and you are open for business.

---

## DECIDE

1. **Does the form go live before the rubric is tuned?** Recommended yes — ship through
   step 5 and let the AI step follow. Nothing is riskier about it and it gets the front
   door open.
2. **Model choice.** Mid-tier is right for triage. Worth one comparison run on the test
   set between a mid and a small model, since the cost difference at this volume is
   trivial but the quality difference on lead 3 and lead 5 might not be — and that
   comparison is itself a documentable evaluation.
3. **Does `/ai-help` appear in the site nav, or is it an unlinked page you send people
   to?** **Decided: yes, it goes in the nav** — as the last item, after Contact, on both
   the root `index.html` and `ai-help/index.html` (marked as the current page there). It
   was added only *after* the form was confirmed working end to end, so the page stayed
   unlinked while it was being tested. **Done.** The root page's script now selects
   `.nav-link[data-target]` instead of `.nav-link`, so it doesn't intercept the new link
   (which has no `data-target` and is a real page, not a hash section). The link keeps the
   `nav-link` class for styling.

4. **Which domain sends the email?** The site's published contact address is
   `contact@storicore.com`, but the intake lives on aaronpitters.com. Resend verifies a
   sending domain, so pick one — probably aaronpitters.com, since that's where the form is
   and a reply from a different domain than the site invites a spam filter's attention.

5. **Tailwind CDN.** *Resolved by the Replit rewrite:* the live site no longer loads
   `cdn.tailwindcss.com` or Google Fonts, and `/ai-help` doesn't either. (The old CSP
   allowed the Tailwind CDN specifically, which is why it's worth remembering that the
   CSP and the CDN went together.)
