// Tests for where the consulting page lives (/consulting/) and everything that points at it:
// the redirects from its earlier addresses, both nav bars, the page's own address tags, the
// sitemap, and a guard against stale references to the old address.
//
// Run:  node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// ── _redirects ───────────────────────────────────────────────────────────────────────────

// Rules from _redirects: "source destination status", blank lines and # comments ignored.
const rules = read('_redirects')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => {
    const [source, destination, status] = line.split(/\s+/);
    return { source, destination, status };
  });

// The four earlier addresses (written as pieces so this file isn't itself a stale reference).
const OLD = ['ai-' + 'consulting', 'ai-' + 'help'];
const EXPECTED_SOURCES = OLD.flatMap((name) => [`/${name}`, `/${name}/*`]);

test('_redirects sends the four earlier addresses to /consulting/ with a 301', () => {
  assert.deepEqual(rules.map((r) => r.source).sort(), [...EXPECTED_SOURCES].sort());
  for (const rule of rules) {
    assert.equal(rule.destination, '/consulting/', `${rule.source} goes straight to the page`);
    assert.equal(rule.status, '301', `${rule.source} is a permanent redirect`);
  }
});

// Does a path match a _redirects source pattern ("*" matches anything, as a splat)?
const matches = (pattern, path) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(path);

test('every redirect is a single hop: no destination is itself a redirect source', () => {
  for (const rule of rules) {
    for (const other of rules) {
      assert.equal(matches(other.source, rule.destination), false,
        `${rule.source} -> ${rule.destination} would be forwarded again by ${other.source}`);
    }
  }
});

test('the destination has a trailing slash, so Pages does not add a second redirect for the folder', () => {
  for (const rule of rules) assert.ok(rule.destination.endsWith('/'), rule.destination);
});

test('the destination really is a page, and the old folder is gone', () => {
  assert.ok(existsSync(join(ROOT, 'consulting', 'index.html')));
  for (const name of OLD) assert.equal(existsSync(join(ROOT, name)), false, `${name}/ should not exist`);
});

// ── The two nav bars ─────────────────────────────────────────────────────────────────────

// [text, href] for every nav-link in a page, in order.
const navLinks = (html) => [...html.matchAll(/<a href="([^"]*)"[^>]*class="nav-link[^"]*"[^>]*>([^<]*)<\/a>/g)]
  .map((m) => [m[2].trim(), m[1]]);

test('both nav bars have a "Consulting" tab to /consulting/, between STORiCORE and Blog', () => {
  for (const page of ['index.html', 'consulting/index.html']) {
    const links = navLinks(read(page));
    assert.deepEqual(links.map(([text]) => text), ['Home', 'About', 'Books', 'STORiCORE', 'Consulting', 'Blog', 'Contact'], page);
    assert.equal(links.find(([text]) => text === 'Consulting')[1], '/consulting/', page);
  }
});

test('on the consulting page its own tab is marked as the current page', () => {
  assert.match(read('consulting/index.html'), /<a href="\/consulting\/" class="nav-link active" aria-current="page">Consulting<\/a>/);
  assert.doesNotMatch(read('index.html'), /aria-current/);
});

// ── The page's own wording and address tags ──────────────────────────────────────────────

test('only the address and the tab changed: the title, heading and share titles still say "AI Consulting"', () => {
  const html = read('consulting/index.html');
  assert.match(html, /<title>AI Consulting - Aaron Pitters<\/title>/);
  assert.match(html, /<h1 class="page-title">AI Consulting<\/h1>/);
  assert.match(html, /<meta property="og:title" content="AI Consulting - Aaron Pitters">/);
});

test('the canonical and share URLs are the new address', () => {
  const html = read('consulting/index.html');
  assert.match(html, /<link rel="canonical" href="https:\/\/aaronpitters\.com\/consulting\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/aaronpitters\.com\/consulting\/">/);
});

test('the sitemap lists the home page and /consulting/', () => {
  const urls = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(urls, ['https://aaronpitters.com/', 'https://aaronpitters.com/consulting/']);
});

// ── No stale references ──────────────────────────────────────────────────────────────────

// Every file in the repo except git's own, node_modules, images, this test, and _redirects
// (which has to name the old addresses to redirect them).
function filesToScan(dir = ROOT) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '.git' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return filesToScan(path);
    const rel = relative(ROOT, path);
    if (rel === '_redirects' || rel === 'tests/consulting-address.test.mjs') return [];
    return /\.(png|ico|jpg|jpeg|gif|webp)$/i.test(name) ? [] : [rel];
  });
}

test('no file mentions the old consulting address (only _redirects may)', () => {
  const stale = [];
  for (const file of filesToScan()) {
    read(file).split('\n').forEach((line, i) => {
      if (line.includes(OLD[0])) stale.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(stale, [], 'update these to /consulting/ (only _redirects names the old address)');
});
