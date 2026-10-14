import type { BookingQuestionDto } from '@ap/contracts';

/** What the customer typed or picked for each of the trip's questions, by question id. */
export type AnswerValues = Record<string, string>;

/** Questions left unanswered that must be answered, by question id. */
export function missingAnswers(questions: BookingQuestionDto[], values: AnswerValues): string[] {
  return questions.filter((q) => q.required && !values[q.id]?.trim()).map((q) => q.id);
}

/** The answers to send with the booking: only questions actually answered. */
export function toAnswers(
  questions: BookingQuestionDto[],
  values: AnswerValues,
): { questionId: string; value: string }[] {
  return questions.flatMap((q) => {
    const value = values[q.id]?.trim();
    return value ? [{ questionId: q.id, value }] : [];
  });
}

/** Choices are shown as cards up to this many options, as a drop-down beyond. */
export const MAX_CHOICE_CARDS = 4;
