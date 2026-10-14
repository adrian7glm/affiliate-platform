import { calendarUtcStamp, googleCalendarUrl as googleLink } from '@ap/contracts';

/**
 * "Add to calendar" for a booked trip: an iCalendar file (Apple Calendar, Outlook, Google import,
 * any phone) and a Google Calendar link that opens the event ready to save. Also the operator's
 * departures calendar, a feed that calendar apps subscribe to.
 */
export interface CalendarEvent {
  /** Stable id, so adding the same ticket twice updates the event instead of duplicating it. */
  uid: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  description: string;
  url: string | null;
  /** Minutes before the start for a reminder; null for none. */
  alarmMinutes?: number | null;
}

export interface CalendarOptions {
  /** Name calendar apps show for a subscribed calendar. */
  name?: string;
  /** How often subscribers should fetch the feed again. */
  refreshMinutes?: number;
}

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Folds a content line at 75 octets, without splitting a UTF-8 character (RFC 5545 §3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function icsFile(event: CalendarEvent, now: Date): string {
  return icsCalendar([event], now);
}

export function icsCalendar(
  events: CalendarEvent[],
  now: Date,
  options: CalendarOptions = {},
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Affiliate Platform//Tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(options.name ? [`X-WR-CALNAME:${escapeText(options.name)}`] : []),
    ...(options.refreshMinutes
      ? [
          `REFRESH-INTERVAL;VALUE=DURATION:PT${options.refreshMinutes}M`,
          `X-PUBLISHED-TTL:PT${options.refreshMinutes}M`,
        ]
      : []),
    ...events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${calendarUtcStamp(now)}`,
      `DTSTART:${calendarUtcStamp(event.startsAt)}`,
      `DTEND:${calendarUtcStamp(event.endsAt)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
      ...(event.url ? [`URL:${event.url}`] : []),
      ...(event.alarmMinutes
        ? [
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            `DESCRIPTION:${escapeText(event.title)}`,
            `TRIGGER:-PT${event.alarmMinutes}M`,
            'END:VALARM',
          ]
        : []),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function googleCalendarUrl(event: CalendarEvent): string {
  return googleLink({ ...event, details: event.description });
}
