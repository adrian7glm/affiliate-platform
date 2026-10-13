import { index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';

export const contactTopicEnum = pgEnum('contact_topic', ['demo', 'question']);

/** Messages sent from the public contact page to the platform owner (demo requests, questions). */
export const contactRequests = pgTable(
  'contact_requests',
  {
    id: id(),
    topic: contactTopicEnum('topic').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    company: text('company'),
    message: text('message').notNull(),
    locale: text('locale').notNull().default('en'),
    /** Set when the platform owner has answered; the admin list shows open requests first. */
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('contact_requests_created').on(t.createdAt),
    index('contact_requests_email').on(t.email),
  ],
);
