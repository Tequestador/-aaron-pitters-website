// Tests for the unlisted Creative AI & Writing Portfolio at /portfolio/creative/.
// Like the applied-AI portfolio it is reachable by direct link only (from a résumé), and the two
// pages are deliberately not linked to each other. The factual checks pin details that came from
// Aaron directly, so a later edit can't quietly change them.
//
// Run:  node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const PAGE = 'portfolio/creative/index.html';
const EVIDENCE = 'portfolio/evidence/michaelmas-seven-run-comparison.html';
const EVIDENCE_URL = '/portfolio/evidence/michaelmas-seven-run-comparison';

const page = read(PAGE);
const evidence = read(EVIDENCE);

test('the creative portfolio has its title, canonical address and a noindex tag', () => {
  assert.match(page, /<title>Creative AI &amp; Writing Portfolio \| Aaron Pitters<\/title>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/aaronpitters\.com\/portfolio\/creative\/">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/aaronpitters\.com\/portfolio\/creative\/">/);
  assert.match(page, /<meta name="robots" content="noindex, follow">/);
  assert.equal(page.match(/<h1[ >]/g).length, 1);
});

test('the share image exists and both the Open Graph and Twitter tags point at it', () => {
  assert.ok(existsSync(join(ROOT, 'images/share/portfolio-creative.jpg')));
  const url = 'https://aaronpitters.com/images/share/portfolio-creative.jpg';
  assert.match(page, new RegExp(`<meta property="og:image" content="${url}">`));
  assert.match(page, new RegExp(`<meta name="twitter:image" content="${url}">`));
  assert.doesNotMatch(page, /application\/ld\+json/);
});

test('the page has no inline event handlers (the live Content Security Policy would block them)', () => {
  const handlers = [...page.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/gi)].map((m) => m[1]);
  assert.deepEqual(handlers, []);
});

test('the page loads nothing from outside the site', () => {
  assert.doesNotMatch(page, /<script[^>]*\ssrc=/i);
  assert.doesNotMatch(page, /@import|url\(\s*['"]?https?:/i);
  assert.doesNotMatch(page, /<(img|iframe|source|video|audio)[^>]*\ssrc=["']https?:/i);
  for (const [tag] of page.matchAll(/<link[^>]*\shref="(https?:[^"]+)"[^>]*>/g)) assert.match(tag, /rel="canonical"/);
});

test('every font, icon and image the page loads exists, and every image has alt text and a size', () => {
  const paths = new Set([...page.matchAll(/(?:href|src)="(\/[^"#?]+\.(?:woff2|png|ico|jpg|webmanifest))(?:\?[^"#]*)?"/g)].map((m) => m[1]));
  for (const m of page.matchAll(/url\('(\/fonts\/[^']+)'\)/g)) paths.add(m[1]);
  for (const path of paths) assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);
  const imgs = [...page.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  assert.equal(imgs.length, 4, 'the four book covers');
  for (const img of imgs) {
    assert.match(img, /\salt="[^"]{10,}"/);
    assert.match(img, /\swidth="\d+"/);
    assert.match(img, /\sheight="\d+"/);
  }
});

test('every in-page link resolves to an id on the page, including the three case studies', () => {
  const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...page.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  for (const wanted of ['writing', 'work', 'michaelmas', 'pipeline', 'first-draft']) {
    assert.ok(anchors.includes(wanted), `nothing links to #${wanted}`);
    assert.ok(ids.has(wanted), `#${wanted} has no target`);
  }
  for (const anchor of anchors) assert.ok(ids.has(anchor), `#${anchor} has no target`);
});

test('the header has no tab for the portfolio and nothing is marked as the current page', () => {
  assert.doesNotMatch(page, /aria-current/);
  assert.doesNotMatch(page.match(/<nav id="primary-nav"[\s\S]*?<\/nav>/)[0], /portfolio/i);
});

test('the page is unlisted: not in the sitemap or robots.txt, and not linked from, or to, any other page', () => {
  assert.doesNotMatch(read('sitemap.xml'), /portfolio/i);
  assert.doesNotMatch(read('robots.txt'), /portfolio|disallow/i);
  for (const other of ['index.html', 'consulting/index.html', 'portfolio/index.html']) {
    assert.doesNotMatch(read(other), /portfolio\/creative/i, `${other} links to the creative portfolio`);
  }
  // It does not link to the applied-AI portfolio either; the evidence page is the only /portfolio/ address it uses.
  assert.doesNotMatch(page, /href="\/portfolio\/?(#[^"]*)?"/);
  assert.doesNotMatch(page, /href="https:\/\/aaronpitters\.com\/portfolio\/?"/);
});

test('the evidence link is tagged ?from=creative, and the evidence page then sends its back link to this page', () => {
  assert.ok(page.includes(`href="${EVIDENCE_URL}?from=creative"`));
  assert.ok(existsSync(join(ROOT, `${EVIDENCE_URL}.html`)));
  assert.ok(page.includes(`<span class="print-url">https://aaronpitters.com${EVIDENCE_URL}</span>`));
  // The default back link still goes to the applied-AI page; the script switches it only for ?from=creative.
  assert.match(evidence, /<a class="back" id="back-link" href="\/portfolio\/#pipeline">/);
  assert.match(evidence, /get\('from'\) === 'creative'\) document\.getElementById\('back-link'\)\.href = '\/portfolio\/creative\/#pipeline'/);
});

test('facts that came from Aaron directly are on the page as given', () => {
  assert.ok(page.includes('<strong>1996</strong>'));                                    // screenplays began in 1996, not 2003
  assert.doesNotMatch(page, /2003/);
  assert.ok(page.includes('co-written with two other screenwriters'));                  // Detriment: two co-writers
  assert.ok(page.includes('Tony Kaye'));
  assert.ok(page.includes('Finalist, Atlanta Film Festival Screenwriting Contest.'));
  assert.ok(page.includes('released January 18, 2024'));                                // Michaelmas illustrated edition
  assert.ok(page.includes('DALL·E in ChatGPT') && page.includes('Lightroom and Photoshop'));
  assert.ok(page.includes('href="https://youtu.be/X9-WT16_drI"'));                       // CIPHER
  assert.ok(page.includes('href="https://youtu.be/ldCKw5BwDyo"'));                       // WALKING MAN
  assert.ok(page.includes('Episode one of the House Fly comic is in production and has not been released yet.'));
  for (const style of ['Daguerreotype', 'Calotype', 'Tintype', 'Ambrotype', 'Albumen print', 'Gum bichromate']) assert.ok(page.includes(`<strong>${style}</strong>`), style);
});

test('LinkedIn points at the current address', () => {
  assert.ok(page.includes('https://www.linkedin.com/in/aaronpitters/'));
  assert.doesNotMatch(page, /aaron-pitters-6015b5143/);
});

test('print: Letter, a white page, no forced page breaks, the header, footer and buttons left off, the masthead on', () => {
  const printBlock = page.slice(page.indexOf('@media print {'), page.indexOf('</style>'));
  assert.match(page, /@page \{ size: Letter;/);
  assert.match(printBlock, /--bg: #fff;/);
  assert.doesNotMatch(printBlock, /break-(before|after):\s*(page|always)/);
  assert.match(printBlock, /\.site-header, \.site-footer[^}]*\.btn, \.btn-secondary \{ display: none !important; \}/);
  assert.match(printBlock, /\.wrap \{ max-width: none; padding-left: 1\.5mm; padding-right: 1\.5mm; \}/);
  assert.match(page, /<p class="print-masthead"><span class="print-name">Aaron Pitters<\/span> · aaronpitters\.com\/portfolio\/creative · aaronpitters@gmail\.com<\/p>/);
  for (const cls of ['.book', '.style', '.insight', '.approach-step', '.scope']) assert.ok(printBlock.includes(cls), `${cls} is not handled for print`);
});
