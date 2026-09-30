// Generates functions/api/_rubric.generated.js from prompts/triage-rubric.md.
//
// Why this exists: the triage rubric is a markdown file that a person edits, but a Pages
// Function can't read files off disk at runtime. So at build time this script copies the
// markdown, verbatim, into a JavaScript module that exports it as one string. The markdown
// stays the only place the rubric is written; the generated file is gitignored and is never
// edited by hand.
//
// Run by Cloudflare Pages as the build command:  node scripts/build-prompt.mjs
// Uses only Node's built-in modules, so there is nothing to install.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// JSON.stringify writes a string literal that is also valid JavaScript, and it escapes
// backticks, quotes, backslashes and newlines correctly. That is why the markdown can hold
// anything without the generated file breaking.
const output = `// GENERATED FILE. Do not edit; do not commit.
// Written by scripts/build-prompt.mjs from prompts/triage-rubric.md on every build.
// To change the rubric, edit the markdown file instead.

export const RUBRIC = ${JSON.stringify(rubric)};
`;

writeFileSync(outputPath, output, 'utf8');

// Shows up in the Cloudflare build log, which is how you confirm the script actually ran.
console.log(`build-prompt: wrote functions/api/_rubric.generated.js (${rubric.length} characters from prompts/triage-rubric.md)`);
