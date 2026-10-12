import { boolean, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from './_common';
import { users } from './identity';

/**
 * Languages configured from the admin area: languages added there (translated entirely from the
 * admin) and settings for the languages that ship as files (e.g. hidden from the picker).
 */
export const languages = pgTable('languages', {
  /** Lowercase BCP 47: "de", "pt-br". */
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  englishName: text('english_name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
});

/** Texts changed or translated from the admin area; they win over the language files. */
export const translations = pgTable(
  'translations',
  {
    lang: text('lang').notNull(),
    /** Flat key, plural forms with their suffix: "public.seatsLeft_few". */
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.lang, t.key] })],
);
