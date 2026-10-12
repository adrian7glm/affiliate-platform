'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { IconAlert } from './icons';

export const INPUT_CLASSES =
  'field-input block w-full min-h-12 rounded-xl border-2 border-line-strong bg-surface px-3.5 py-2.5 text-fg placeholder:text-muted disabled:opacity-60 aria-[invalid=true]:border-danger';

interface ShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Visible "(opțional)" marker next to the label. */
  optionalText?: string;
  className?: string;
}

interface ShellRenderProps {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

/**
 * Label above, hint above the control (so autofill popups do not cover it), error below.
 * Hint and error are wired through aria-describedby.
 */
export function FieldShell({
  label,
  hint,
  error,
  optionalText,
  className = '',
  id: givenId,
  children,
}: ShellProps & { id?: string; children: (props: ShellRenderProps) => ReactNode }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="font-semibold">
        {label}
        {optionalText ? (
          <span className="ml-1 font-normal text-muted">({optionalText})</span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger-fg">
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export type FieldProps = ShellProps & InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, hint, error, optionalText, className, id, ...input }: FieldProps) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      optionalText={optionalText}
      className={className}
      id={id}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={INPUT_CLASSES}
          {...input}
        />
      )}
    </FieldShell>
  );
}

export type SelectFieldProps = ShellProps & SelectHTMLAttributes<HTMLSelectElement>;

export function SelectField({
  label,
  hint,
  error,
  optionalText,
  className,
  id,
  children,
  ...select
}: SelectFieldProps) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      optionalText={optionalText}
      className={className}
      id={id}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <select
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={INPUT_CLASSES}
          {...select}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export type TextareaFieldProps = ShellProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextareaField({
  label,
  hint,
  error,
  optionalText,
  className,
  id,
  ...textarea
}: TextareaFieldProps) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      optionalText={optionalText}
      className={className}
      id={id}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <textarea
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${INPUT_CLASSES} min-h-24`}
          {...textarea}
        />
      )}
    </FieldShell>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface ChoiceGroupProps<T extends string> {
  legend: ReactNode;
  /** Hide the legend visually (it stays available to screen readers). */
  legendHidden?: boolean;
  name: string;
  value: T | null;
  onChange: (value: T) => void;
  options: ChoiceOption<T>[];
  /** Tailwind grid classes for the options. */
  gridClassName?: string;
  hint?: ReactNode;
  error?: ReactNode;
  type?: 'radio';
}

/** Mutually exclusive options as large tappable cards built on native radio inputs. */
export function ChoiceGroup<T extends string>({
  legend,
  legendHidden = false,
  name,
  value,
  onChange,
  options,
  gridClassName = 'grid grid-cols-1 gap-2',
  hint,
  error,
}: ChoiceGroupProps<T>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset
      className="min-w-0"
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
    >
      <legend className={legendHidden ? 'visually-hidden' : 'mb-1.5 font-semibold'}>
        {legend}
      </legend>
      {hint ? (
        <p id={hintId} className="mb-2 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <div className={gridClassName}>
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="choice-body">
              <span className="font-semibold">{option.label}</span>
              {option.description ? (
                <span className="text-sm opacity-80">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger-fg"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
