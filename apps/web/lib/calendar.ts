/** "Add to Google Calendar" link for a trip; the API serves the same event as an .ics file. */

/** 20261006T070000Z */
function utcStamp(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function googleCalendarUrl(event: {
  title: string;
  startsAt: string;
  endsAt: string;
  details: string;
  location?: string | null;
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${utcStamp(event.startsAt)}/${utcStamp(event.endsAt)}`,
    details: event.details,
  });
  if (event.location) params.set('location', event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
