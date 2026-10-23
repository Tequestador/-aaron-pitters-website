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
  const paths = new Set([...page.matchAll(/(?:href|src)="(\/[^"#?]+\.(?:woff2|png|ico|webmanifest))"/g)].map((m) => m[1]));
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
