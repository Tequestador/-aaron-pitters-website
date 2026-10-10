// Generates functions/api/_rubric.generated.js from prompts/triage-rubric.md.
//
// Why this exists: the triage rubric is a markdown file that a person edits, but a Pages
// Function can't read files off disk at runtime. So at build time this script copies the
// markdown, verbatim, into a JavaScript module that exports it as one string. The markdown
// stays the only place the rubric is written; the generated file is gitignored and is never
// edited by hand.
//
// The same file also carries the seven standard questions from §11 as STANDARD_QUESTIONS.
// The model writes a marker instead of those questions and the function inserts them, so
// they reach clients exactly as the rubric gives them. They are extracted here, not copied
// into a JavaScript file by hand, so they cannot drift. If the rubric doesn't contain
// exactly seven, the build fails.
//
// Run by Cloudflare Pages as the build command:  node scripts/build-prompt.mjs
// Uses only Node's built-in modules, so there is nothing to install.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractStandardQuestions } from './standard-questions.mjs';

// Paths are relative to this script, not to wherever the command was run from.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(repoRoot, 'prompts', 'triage-rubric.md');
const outputPath = join(repoRoot, 'functions', 'api', '_rubric.generated.js');

let rubric;
try {
  rubric = readFileSync(sourcePath, 'utf8');
} catch (err) {
  // Fail the build. A deploy that quietly ships without its rubric would send the model
  // an empty prompt, which is worse than a deploy that doesn't happen.
  console.error(`build-prompt: cannot read ${sourcePath}: ${err.message}`);
  process.exit(1);
}

if (rubric.trim().length === 0) {
  console.error(`build-prompt: ${sourcePath} is empty. Refusing to generate an empty prompt.`);
  process.exit(1);
}

// Fails the build (rather than shipping wrong questions to clients) if §11 isn't exactly
// seven single-line numbered questions.
let standardQuestions;
try {
  standardQuestions = extractStandardQuestions(rubric);
} catch (err) {
  console.error(`build-prompt: ${err.message}`);
  process.exit(1);
}

// JSON.stringify writes a string literal that is also valid JavaScript, and it escapes
// backticks, quotes, backslashes and newlines correctly. That is why the markdown can hold
// anything without the generated file breaking.
const output = `// GENERATED FILE. Do not edit; do not commit.
// Written by scripts/build-prompt.mjs from prompts/triage-rubric.md on every build.
// To change the rubric, edit the markdown file instead.

export const RUBRIC = ${JSON.stringify(rubric)};

// The seven standard questions from §11, in order, without their numbers.
export const STANDARD_QUESTIONS = ${JSON.stringify(standardQuestions, null, 2)};
`;

writeFileSync(outputPath, output, 'utf8');

// Shows up in the Cloudflare build log, which is how you confirm the script actually ran.
console.log(`build-prompt: wrote functions/api/_rubric.generated.js (${rubric.length} characters and ${standardQuestions.length} standard questions from prompts/triage-rubric.md)`);
