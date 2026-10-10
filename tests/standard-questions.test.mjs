// Tests for the build step that pulls the seven standard questions out of the rubric
// (scripts/standard-questions.mjs, run by scripts/build-prompt.mjs). The point: if §11 stops
// being exactly seven single-line numbered questions, the BUILD fails, so wrong questions can
// never reach a paying client.
//
// Run:  node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { extractStandardQuestions } from '../scripts/standard-questions.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const RUBRIC = readFileSync(join(REPO, 'prompts', 'triage-rubric.md'), 'utf8');
const HEADING = '### The seven standard questions (Workflow Review only)';

// A minimal rubric whose §11 list is the given lines, for the failure cases.
const rubricWith = (listLines) => [
  '# Rubric', '', '## 11. Stage 2', '', HEADING, '', 'Intro text for the list.', '',
  ...listLines, '', '### Writing the personalized questions', '', '1. Not a standard question.', '',
].join('\n');
const seven = (n = 7) => Array.from({ length: n }, (_, i) => `${i + 1}. Question number ${i + 1}?`);

test('the real rubric yields exactly seven questions, in order, without numbers', () => {
  const questions = extractStandardQuestions(RUBRIC);
  assert.equal(questions.length, 7);
  assert.match(questions[0], /^Walk me through the process you want help with/);
  assert.match(questions[6], /^What practical limits should I know about\?/);
  assert.ok(questions.every((q) => !/^\d+\./.test(q)), 'numbers are added later, not stored');
});

test('only the standard-questions section is read (the personalized-questions list after it is not)', () => {
  assert.deepEqual(extractStandardQuestions(rubricWith(seven())), seven().map((l) => l.replace(/^\d+\.\s+/, '')));
});

test('Windows line endings are fine', () => {
  assert.equal(extractStandardQuestions(rubricWith(seven()).replace(/\n/g, '\r\n')).length, 7);
});

const bad = {
  'six questions': [rubricWith(seven(6)), /expected exactly 7.*found 6/],
  'eight questions': [rubricWith(seven(8)), /expected exactly 7.*found 8/],
  'no questions': [rubricWith([]), /expected exactly 7.*found 0/],
  'a missing heading': [RUBRIC.replace(HEADING, '### Something else'), /cannot find the heading/],
  'a question wrapped onto a second line': [
    rubricWith([...seven(6), '7. A long question that', '   runs onto a second line?']),
    /single line/,
  ],
  'stray text after the list': [rubricWith([...seven(), 'Note: ask these nicely.']), /single line/],
  'numbering that skips': [rubricWith(['1. A?', '2. B?', '4. D?', '5. E?', '6. F?', '7. G?', '8. H?']), /not numbered 1 to 7 in order/],
  'numbering that repeats': [rubricWith(['1. A?', '2. B?', '3. C?', '3. D?', '5. E?', '6. F?', '7. G?']), /not numbered 1 to 7 in order/],
};
for (const [name, [markdown, message]] of Object.entries(bad)) {
  test(`extraction refuses ${name}`, () => {
    assert.throws(() => extractStandardQuestions(markdown), message);
  });
}

// The build script itself, run for real in a scratch copy of the repo layout, so a broken
// rubric is shown to stop the build (non-zero exit) and write nothing.
async function runBuild(rubricMarkdown) {
  const root = mkdtempSync(join(tmpdir(), 'build-test-'));
  try {
    cpSync(join(REPO, 'scripts'), join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'prompts'));
    mkdirSync(join(root, 'functions', 'api'), { recursive: true });
    writeFileSync(join(root, 'prompts', 'triage-rubric.md'), rubricMarkdown);
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'build-prompt.mjs')], { encoding: 'utf8' });
    const generated = join(root, 'functions', 'api', '_rubric.generated.js');
    // Load the module the build wrote, so tests check what the function would really import.
    const module = existsSync(generated) ? await import(`${pathToFileURL(generated).href}?${Date.now()}`) : null;
    return { status: result.status, stderr: result.stderr, stdout: result.stdout, generated: module };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the build succeeds on the real rubric and writes all seven questions, and the rubric, into the generated module', async () => {
  const { status, generated, stdout } = await runBuild(RUBRIC);
  assert.equal(status, 0);
  assert.match(stdout, /7 standard questions/);
  assert.deepEqual(generated.STANDARD_QUESTIONS, extractStandardQuestions(RUBRIC));
  assert.equal(generated.STANDARD_QUESTIONS.length, 7);
  assert.equal(generated.RUBRIC, RUBRIC, 'the rubric itself is still copied verbatim');
});

test('the build FAILS, and writes no module, when the rubric has six standard questions', async () => {
  const { status, stderr, generated } = await runBuild(rubricWith(seven(6)));
  assert.notEqual(status, 0);
  assert.match(stderr, /expected exactly 7/);
  assert.equal(generated, null);
});

test('the build FAILS when a standard question is wrapped onto two lines', async () => {
  const { status, stderr, generated } = await runBuild(rubricWith([...seven(6), '7. First half of a question', '   second half?']));
  assert.notEqual(status, 0);
  assert.match(stderr, /single line/);
  assert.equal(generated, null);
});
