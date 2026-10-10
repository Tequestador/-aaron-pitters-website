# AI Consulting intake — project context

Why this exists and what was decided against. Read this before proposing changes to the
design; most of the obvious improvements were considered and rejected for reasons that
aren't visible in the code.

Companion documents: `prompts/triage-rubric.md` (the prompt), `docs/build-spec.md` (the
build), `tests/test-leads.md` (the test set).

---

## What the system does

A visitor fills in four questions. An OpenAI model reads the answers against a written rubric and
emails Aaron a decision brief: a verdict, a recommended service level, flags, and two
drafted replies. Aaron edits a draft, writes one paragraph himself, and sends it.

The AI does the reading, structuring, and drafting. The human does the judgment and the
deciding. The method has a public name — **AI-assisted, human-directed** — and the
submitter is told about it on the form.

## The three service levels

What separates them is depth of answer, not client size.

- **Quick Read** (free) — a direction, one useful pointer, and an honest statement of
  whether they need to pay for anything.
- **Explainer** ($50) — a written explanation of one thing they're confused about.
- **Workflow Review** ($200) — a diagnosis, an approach, a sequence, and what not to
  automate.

Implementation work exists but is rare and never offered by the triage system.

## Design decisions and why

**The free level is meant to be sufficient for some people.** Someone who reads the free
answer, understands their situation, and never pays is a success. Much of the intended
audience doesn't know what tools exist; telling them is the service. The rubric instructs
the model to look actively for the case where the honest answer is "you don't need to hire
me," because a model left to its own inclinations will always find something to sell.

**Email is the interface.** No dashboard, no approve-and-send button. A mail client
already does forwarding, editing, sending, searching, and works on a phone. A review UI
would save seconds per lead and cost a permanent maintenance surface.

**No database.** The inbox is the record. A lead log is the first thing that sounds
obviously necessary and isn't.

**Nothing reaches a client unreviewed.** Not a technical limitation — the design premise.

**The *My take* section is structurally protected.** Every response ends with a paragraph
only Aaron writes. The rubric forbids the model from drafting it, suggesting its content,
or leaving a placeholder sentence "to edit," because a suggested sentence becomes a written
sentence on a tired Thursday. The form tells the submitter this section is his. If the
model ever fills it, a published promise becomes false.

**The brief names where Aaron's judgment is needed rather than supplying it.** One line
stating the question the model can't answer from a form. That's the honest way to help
with *My take* — point at the gap, don't fill it.

**Hallucination is the worst available failure.** The audience is people who cannot
evaluate AI claims, which is why they wrote in. A confidently named product that doesn't
do what was claimed, in a free answer, to someone who will believe it, is worse than any
misrouted tier. The rubric requires "Aaron should verify" over assertion. The test set
includes a fictional industry product to check this.

**The AI step is not allowed to lose a lead.** If the API call fails, the raw submission
still reaches Aaron. AI saves time here; it does not stand between Aaron and a prospective
client.

## Rejected, deliberately

- A review dashboard or client portal
- A lead database
- Payment processing, accounts, scheduling
- Auto-sending anything to a client
- A second AI pass to improve the drafts
- Building custom software for clients as a default recommendation — the rubric's own
  order is process redesign first, existing software second, AI third, custom development
  last
- Migrating the site off Cloudflare Pages

## What would count as this going wrong

Scope creep into a product. The specific shape to watch for: a client portal, a lead
database, tier-recommendation tuning, or a third iteration of the email format. Each is
individually reasonable and collectively how a two-week project becomes a year.

The system is done when it works and can be explained. It is not waiting on traffic,
conversions, or clients to be finished.

---


