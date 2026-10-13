/** 20261006T070000Z: a moment in UTC as calendar files and links write it. */
export function calendarUtcStamp(moment: Date | string): string {
  return new Date(moment)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * "Add to Google Calendar" link for a trip, shared by the ticket page and the ticket email
 * (the API also serves the same event as an .ics file).
 */
export function googleCalendarUrl(event: {
  title: string;
  startsAt: Date | string;
  endsAt: Date | string;
  details: string;
  location?: string | null;
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${calendarUtcStamp(event.startsAt)}/${calendarUtcStamp(event.endsAt)}`,
    details: event.details,
  });
  if (event.location) params.set('location', event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
