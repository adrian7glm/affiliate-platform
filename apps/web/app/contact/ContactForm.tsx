'use client';

import type { ContactTopic } from '@ap/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { ChoiceGroup, Field, TextareaField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconCheck } from '@/components/icons';
import { Rich, slots } from '@/components/Rich';
import { isApiError } from '@/lib/api';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from '@/lib/contact';
import { publicApi } from '@/lib/endpoints';

interface Errors {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
}

export function ContactForm({ initialTopic }: { initialTopic: ContactTopic }) {
  const { t, lang } = useT();
  const [topic, setTopic] = useState<ContactTopic>(initialTopic);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (attempt === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  useEffect(() => {
    if (sent) doneRef.current?.focus();
  }, [sent]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const cleanEmail = normalizeEmail(email);
    const cleanPhone = phone.trim() ? normalizePhone(phone) : '';
    const next: Errors = {};
    if (!name.trim()) next.name = t('public.contact.errName');
    if (!isValidEmail(cleanEmail)) next.email = t('public.contact.errEmail');
    if (cleanPhone && !isValidPhone(cleanPhone)) next.phone = t('public.errorPhone');
    if (topic === 'question' && !message.trim()) next.message = t('public.contact.errMessage');
    setErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      await publicApi.contact({
        topic,
        name: name.trim(),
        email: cleanEmail,
        phone: cleanPhone || undefined,
        company: company.trim() || undefined,
        message: message.trim(),
        locale: lang,
        website: website || undefined,
      });
      setSent(true);
    } catch (err) {
      if (isApiError(err) && err.status === 429) setError(t('public.contact.tooMany'));
      else if (isApiError(err) && err.isNetwork) setError(t('common.errorNetwork'));
      else setError(t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className="flex flex-col items-start gap-3 rounded-3xl border border-line bg-surface p-5 outline-none"
      >
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-success-soft text-success-fg">
          <IconCheck size={28} />
        </span>
        <h2 className="text-xl font-bold">{t('public.contact.sentTitle')}</h2>
        <p className="text-muted">
          {t('public.contact.sentText', { email: normalizeEmail(email) })}
        </p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-5 rounded-3xl border border-line bg-surface p-4 sm:p-5"
    >
      <ChoiceGroup<ContactTopic>
        legend={t('public.contact.topic')}
        name="topic"
        value={topic}
        onChange={setTopic}
        gridClassName="grid gap-2 sm:grid-cols-2"
        options={[
          {
            value: 'demo',
            label: t('public.contact.topicDemo'),
            description: t('public.contact.topicDemoHint'),
          },
          {
            value: 'question',
            label: t('public.contact.topicQuestion'),
            description: t('public.contact.topicQuestionHint'),
          },
        ]}
      />
      <Field
        label={t('public.contact.name')}
        name="name"
        autoComplete="name"
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <Field
        label={t('public.contact.company')}
        optionalText={t('common.optional')}
        name="organization"
        autoComplete="organization"
        maxLength={120}
        value={company}
        onChange={(e) => setCompany(e.target.value)}
      />
      <Field
        label={t('public.email')}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <Field
        label={t('public.phone')}
        optionalText={t('common.optional')}
        hint={t('public.contact.phoneHint')}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={errors.phone}
      />
      <TextareaField
        label={t('public.contact.message')}
        optionalText={topic === 'demo' ? t('common.optional') : undefined}
        hint={topic === 'demo' ? t('public.contact.messageDemoHint') : undefined}
        name="message"
        rows={5}
        maxLength={2000}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        error={errors.message}
      />
      {/* Hidden from people (and screen readers); bots fill it in and are ignored. */}
      <div aria-hidden="true" className="visually-hidden">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" loading={busy} loadingText={t('public.contact.sending')}>
          {topic === 'demo' ? t('public.contact.sendDemo') : t('public.contact.send')}
        </Button>
        <p className="text-sm text-muted">
          <Rich
            text={t('public.contact.privacyNote', slots('privacy'))}
            parts={{
              privacy: (
                <a
                  href={`/legal/privacy?lang=${lang}`}
                  className="font-semibold text-brand-strong underline"
                >
                  {t('public.privacyLink')}
                </a>
              ),
            }}
          />
        </p>
      </div>
    </form>
  );
}
