// Tests for the STORiCORE® trademark notices.
//
// STORiCORE is registered (Reg. No. 8,544,584) for the SaaS writing-app services only, not for
// comics, film, audio, games, consulting or books. So the ® is used sparingly and on purpose:
//   - every page footer carries the same legal line, matching storicore.com;
//   - at most one ® per page outside the footer, and only where the text is about the apps;
//   - never in titles, meta tags, alt text, URLs or structured data.
// There is no shared template, so the markup is repeated on each page. These tests are what
// keep the copies the same.
//
// Run:  node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const PAGES = ['index.html', 'consulting/index.html', 'portfolio/index.html', 'portfolio/creative/index.html'];

// The ® as it appears in the markup: a raised, screen-reader-hidden sign styled by .reg.
const MARK = '<sup class="reg" aria-hidden="true">&reg;</sup>';

const FOOTER_LINE =
  '<span>&copy; <span id="current-year"></span> Aaron Pitters and STORiCORE LLC. All rights reserved. ' +
  `STORiCORE${MARK} is a registered trademark of STORiCORE LLC.</span>`;

const count = (text, needle) => text.split(needle).length - 1;
const footerOf = (html) => html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
const head = (html) => html.slice(0, html.indexOf('</head>'));

test('every page footer has the exact copyright and trademark line', () => {
  for (const page of PAGES) {
    assert.ok(footerOf(read(page)).includes(FOOTER_LINE), page);
  }
});

test('the ® is only ever written as the .reg mark, never as a bare symbol or entity', () => {
  for (const page of PAGES) {
    const html = read(page);
    const all = count(html, '&reg;') + count(html, '®') + count(html, '&#174;') + count(html, '&#xAE;');
    assert.equal(all, count(html, MARK), page);
  }
});

test('each page uses the ® at most once outside the footer', () => {
  for (const page of PAGES) {
    const html = read(page);
    const outside = html.replace(footerOf(html), '');
    assert.ok(count(outside, MARK) <= 1, page);
  }
});

test('the home page puts its one ® on the writing-apps line', () => {
  const html = read('index.html');
  assert.ok(html.includes(`<p>STORiCORE${MARK} writing apps include 1st Draft,`));
});

test('no ® in titles, meta tags, structured data or alt text', () => {
  for (const page of PAGES) {
    const html = read(page);
    // Everything in <head>: title, meta descriptions, Open Graph, Twitter, JSON-LD.
    assert.ok(!/&reg;|®|&#174;|&#xAE;/i.test(head(html)), `${page} <head>`);
    for (const [, alt] of html.matchAll(/alt="([^"]*)"/g)) {
      assert.ok(!/&reg;|®/.test(alt), `${page} alt="${alt}"`);
    }
  }
});

test('every page that uses the mark styles it with .reg at 0.65em', () => {
  for (const page of PAGES) {
    assert.match(read(page), /\.reg \{ font-size: \.65em; vertical-align: super; line-height: 0; \}/, page);
  }
});
