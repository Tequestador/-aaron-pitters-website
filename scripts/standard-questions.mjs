// Pulls the seven standard questions out of the rubric markdown (§11), so the rubric stays the
// only place they are written. Used by scripts/build-prompt.mjs at build time, and by the tests.
//
// Why a function that fails loudly: the questions go to paying clients "exactly as written".
// If someone edits §11 and the extraction quietly returns six questions, or half of a
// question that was wrapped onto a second line, every Workflow Review email would go out
// wrong. A build that stops is better than a deploy that does that.

const HEADING = '### The seven standard questions (Workflow Review only)';
const EXPECTED = 7;

// Returns the seven questions as an array of strings, without their numbers, in order.
// Throws an Error saying what is wrong unless it finds exactly seven.
export function extractStandardQuestions(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  const start = lines.findIndex((line) => line.trim() === HEADING);
  if (start === -1) {
    throw new Error(`cannot find the heading "${HEADING}" in the rubric`);
  }
  // The section runs until the next heading of any level.
  let end = lines.findIndex((line, i) => i > start && /^#{1,6}\s/.test(line));
  if (end === -1) end = lines.length;

  const questions = [];
  for (const line of lines.slice(start + 1, end)) {
    const numbered = /^(\d+)\.\s+(\S.*)$/.exec(line);
    if (numbered) {
      const number = Number(numbered[1]);
      if (number !== questions.length + 1) {
        throw new Error(`the standard questions are not numbered 1 to ${EXPECTED} in order (found "${number}." after ${questions.length})`);
      }
      questions.push(numbered[2].trimEnd());
    } else if (questions.length > 0 && line.trim() !== '') {
      // Text after the list has started that is not a question: most likely a question
      // that was wrapped onto a second line. Taking only its first line would cut it.
      throw new Error(`each standard question must be on a single line, but this line follows question ${questions.length}: "${line.trim().slice(0, 60)}"`);
    }
  }

  if (questions.length !== EXPECTED) {
    throw new Error(`expected exactly ${EXPECTED} standard questions in the rubric (§11), found ${questions.length}`);
  }
  return questions;
}
