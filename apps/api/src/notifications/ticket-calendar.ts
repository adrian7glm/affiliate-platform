import type { Translator } from '@ap/i18n';
import type { CalendarEvent } from '../common/calendar';

/** The calendar event of a ticket, in the customer's language. */
export function ticketCalendarEvent(
  ticket: {
    tenantName: string;
    productName: string;
    reference: string;
    startsAt: string;
    endsAt: string;
    meetingPoint: string | null;
    url: string;
  },
  t: Translator,
): CalendarEvent {
  const startsAt = new Date(ticket.startsAt);
  return {
    // Same ticket, same event: adding it twice updates it instead of creating a copy.
    uid: `${ticket.reference}.${startsAt.getTime()}@tickets`,
    title: `${ticket.productName} · ${ticket.tenantName}`,
    startsAt,
    endsAt: new Date(ticket.endsAt),
    location: ticket.meetingPoint,
    description: t.t('email.calendar.description', {
      reference: ticket.reference,
      url: ticket.url,
    }),
    url: ticket.url,
    alarmMinutes: 120,
  };
}

export function ticketCalendarFilename(reference: string): string {
  return `${reference}.ics`;
}
