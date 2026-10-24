// Tests for the unlisted AI Workflow Portfolio at /portfolio/ and its evidence page.
// The page is meant to be reachable by direct link only (from a résumé), so most of these pin
// the "unlisted" behavior: noindex, not in the sitemap, not linked from the other pages, and
// nothing in robots.txt that would stop Google from reading the noindex.
//
// Run:  node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const PAGE = 'portfolio/index.html';
const EVIDENCE = 'portfolio/evidence/michaelmas-seven-run-comparison.html';
// Cloudflare Pages serves a .html file at the address without the extension.
const EVIDENCE_URL = '/portfolio/evidence/michaelmas-seven-run-comparison';

const page = read(PAGE);
const evidence = read(EVIDENCE);

test('the portfolio page has its title, canonical address and a noindex tag', () => {
  assert.match(page, /<title>AI Workflow Portfolio \| Aaron Pitters<\/title>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/aaronpitters\.com\/portfolio\/">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/aaronpitters\.com\/portfolio\/">/);
  assert.match(page, /<meta name="robots" content="noindex, follow">/);
});

test('the share image exists and both the Open Graph and Twitter tags point at it', () => {
  assert.ok(existsSync(join(ROOT, 'images/share/portfolio.jpg')));
  const url = 'https://aaronpitters.com/images/share/portfolio.jpg';
  assert.match(page, new RegExp(`<meta property="og:image" content="${url}">`));
  assert.match(page, new RegExp(`<meta name="twitter:image" content="${url}">`));
});

test('the portfolio page has no JSON-LD', () => {
  assert.doesNotMatch(page, /application\/ld\+json/);
});

test('the evidence page is noindex and its canonical matches the address Pages serves', () => {
  assert.match(evidence, /<meta name="robots" content="noindex, follow">/);
  assert.match(evidence, new RegExp(`<link rel="canonical" href="https://aaronpitters\\.com${EVIDENCE_URL}">`));
  assert.match(evidence, /<title>Michaelmas Seven-Run Comparison \| Aaron Pitters<\/title>/);
});

test('the portfolio links to the evidence page at the address Pages serves, and it links back to #pipeline', () => {
  assert.ok(page.includes(`href="${EVIDENCE_URL}"`));
  assert.ok(!page.includes('michaelmas-seven-run-comparison.html'));
  assert.ok(existsSync(join(ROOT, `${EVIDENCE_URL}.html`)));
  assert.ok(evidence.includes('href="/portfolio/#pipeline"'));
});

test('neither page has an inline event handler (the live Content Security Policy would block it)', () => {
  for (const [name, html] of [[PAGE, page], [EVIDENCE, evidence]]) {
    const handlers = [...html.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/gi)].map((m) => m[1]);
    assert.deepEqual(handlers, [], `${name} has inline handlers`);
  }
});

test('neither page loads anything from outside the site', () => {
  for (const [name, html] of [[PAGE, page], [EVIDENCE, evidence]]) {
    assert.doesNotMatch(html, /<script[^>]*\ssrc=/i, `${name} loads an external script`);
    assert.doesNotMatch(html, /@import|url\(\s*['"]?https?:/i, `${name} loads external CSS or fonts`);
    assert.doesNotMatch(html, /<(img|iframe|source|video|audio)[^>]*\ssrc=["']https?:/i, `${name} loads an external image or frame`);
    // The only <link> to another origin is the canonical address.
    const links = [...html.matchAll(/<link[^>]*\shref="(https?:[^"]+)"[^>]*>/g)];
    for (const [tag] of links) assert.match(tag, /rel="canonical"/, `${name}: ${tag}`);
  }
});

test('every font and icon the portfolio page loads exists in the repo', () => {
  const paths = new Set([...page.matchAll(/(?:href|src)="(\/[^"#?]+\.(?:woff2|png|ico|webmanifest))(?:\?[^"#]*)?"/g)].map((m) => m[1]));
  for (const m of page.matchAll(/url\('(\/fonts\/[^']+)'\)/g)) paths.add(m[1]);
  assert.ok(paths.size > 0);
  for (const path of paths) assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);
});

test('every in-page link on the portfolio resolves to an id on the page', () => {
  const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...page.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.includes('pipeline') && anchors.includes('inquiry'));
  for (const anchor of anchors) assert.ok(ids.has(anchor), `#${anchor} has no target`);
});

test('the header has no tab for the portfolio and nothing is marked as the current page', () => {
  assert.doesNotMatch(page, /aria-current/);
  const nav = page.match(/<nav id="primary-nav"[\s\S]*?<\/nav>/)[0];
  assert.doesNotMatch(nav, /portfolio/i);
});

test('the portfolio is not in the sitemap, not blocked in robots.txt, and not linked from the other pages', () => {
  assert.doesNotMatch(read('sitemap.xml'), /portfolio/i);
  assert.doesNotMatch(read('robots.txt'), /portfolio|disallow/i);
  assert.doesNotMatch(read('index.html'), /\/portfolio/i);
  assert.doesNotMatch(read('consulting/index.html'), /\/portfolio/i);
});

test('the hamburger breakpoint in the CSS and in the script agree at 800px', () => {
  assert.match(page, /@media \(max-width: 799px\)/);
  assert.match(page, /matchMedia\('\(min-width: 800px\)'\)/);
});

// ── Print layout ────────────────────────────────────────────────────────────────────────

const printBlock = page.slice(page.indexOf('@media print {'), page.indexOf('</style>'));

test('the print-only masthead is on the page, hidden on screen and shown in print', () => {
  assert.match(page, /<p class="print-masthead"><span class="print-name">Aaron Pitters<\/span> · aaronpitters\.com\/portfolio · aaronpitters@gmail\.com<\/p>/);
  assert.match(page, /\.print-only, \.print-masthead, \.print-url \{ display: none; \}/);
  assert.match(printBlock, /\.print-masthead \{ display: block;/);
});

test('print keeps Letter, a white page, and hides the header, nav, footer and print button', () => {
  assert.match(page, /@page \{ size: Letter;/);
  assert.match(printBlock, /--bg: #fff;/);
  assert.match(printBlock, /\.site-header, \.site-footer[^}]*\.btn, \.btn-secondary \{ display: none !important; \}/);
});

test('print has no forced page breaks, so the document runs to about four pages', () => {
  assert.doesNotMatch(printBlock, /break-(before|after):\s*(page|always)/);
  assert.doesNotMatch(printBlock, /page-break-/);
});

test('print keeps cards, tiles and callouts whole, and keeps the evidence note with its section', () => {
  const avoid = printBlock.match(/([^{}]+)\{ break-inside: avoid; \}/)[1];
  for (const cls of ['.insight', '.result', '.metric', '.sequence div', '.approach-step', '.flow-step', '.scope', '.side-note', '.evidence']) {
    assert.ok(avoid.includes(cls), `${cls} is not kept whole`);
  }
  assert.match(printBlock, /\.scope \{ break-after: avoid; \}/);
});

test('print insets the page so right-hand borders are not clipped at the printable edge', () => {
  assert.match(printBlock, /\.wrap \{ max-width: none; padding-left: 1\.5mm; padding-right: 1\.5mm; \}/);
});

test('the comparison link prints with its address beside it, and that address matches the evidence page canonical', () => {
  const url = 'https://aaronpitters.com' + EVIDENCE_URL;
  assert.ok(page.includes(`>Open comparison ↗<span class="print-url">${url}</span></a>`));
  assert.ok(evidence.includes(`<link rel="canonical" href="${url}">`));
  assert.match(printBlock, /#inquiry \.evidence a/);   // only the other evidence row's link stays off the page
  assert.match(printBlock, /\.print-url \{ display: inline;/);
});

test('the print button is named by its visible text, without an arrow', () => {
  const button = page.match(/<button id="print-btn"[^>]*>([^<]*)<\/button>/);
  assert.equal(button[1], 'Print / Save PDF');
  assert.match(button[0], /aria-label="Print \/ Save PDF/);
});

test('the hero buttons keep a space before their arrow, and the H1 balances each phrase', () => {
  assert.match(page, /\.hero-cta a \{ gap: \.3em; \}/);
  assert.match(page, /\.hero h1 \{[^}]*text-wrap: balance;/);
  assert.match(page, /\.hero h1 em \{ display: block;/);
});

test('the flow arrows sit in the gap with no patch behind them', () => {
  const rule = page.match(/\.flow-step:not\(:last-child\)::after \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /background/);
});
