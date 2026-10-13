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

/**
 * Addresses of the operator's departures calendar: the https feed, the same as webcal:// (Apple
 * Calendar and Outlook subscribe when it is opened) and Google Calendar's "add by URL" page.
 */
export function calendarFeedUrls(
  apiUrl: string,
  token: string,
  lang: string,
): { https: string; webcal: string; google: string } {
  const https = `${apiUrl}/public/calendar/${encodeURIComponent(token)}.ics?lang=${encodeURIComponent(lang)}`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}
