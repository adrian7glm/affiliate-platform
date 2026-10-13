'use client';

import type { BookingQuestionDto } from '@ap/contracts';
import { ChoiceGroup, Field, SelectField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { type AnswerValues, MAX_CHOICE_CARDS } from '@/lib/questions';

/** The operator's own questions on a booking form, in the page's language. */
export function BookingQuestions({
  questions,
  values,
  onChange,
  errors,
}: {
  questions: BookingQuestionDto[];
  values: AnswerValues;
  onChange: (questionId: string, value: string) => void;
  /** Error message by question id. */
  errors: Record<string, string | undefined>;
}) {
  const { t } = useT();
  const optional = t('public.questions.optional');
  return (
    <>
      {questions.map((q) => {
        const value = values[q.id] ?? '';
        const label = q.label;
        if (q.kind === 'text') {
          return (
            <Field
              key={q.id}
              label={label}
              name={`question-${q.id}`}
              optionalText={q.required ? undefined : optional}
              required={q.required}
              maxLength={500}
              value={value}
              onChange={(e) => onChange(q.id, e.target.value)}
              error={errors[q.id]}
            />
          );
        }
        if (q.options.length <= MAX_CHOICE_CARDS) {
          return (
            <ChoiceGroup
              key={q.id}
              legend={q.required ? label : `${label} (${optional})`}
              name={`question-${q.id}`}
              value={value || null}
              onChange={(next) => onChange(q.id, next)}
              options={q.options.map((o) => ({ value: o.value, label: o.label }))}
              gridClassName="grid grid-cols-2 gap-2"
              error={errors[q.id]}
            />
          );
        }
        return (
          <SelectField
            key={q.id}
            label={label}
            name={`question-${q.id}`}
            optionalText={q.required ? undefined : optional}
            required={q.required}
            value={value}
            onChange={(e) => onChange(q.id, e.target.value)}
            error={errors[q.id]}
          >
            <option value="">{t('public.questions.choose')}</option>
            {q.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        );
      })}
    </>
  );
}
