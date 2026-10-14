/** "Add to Google Calendar" link for a trip; the API serves the same event as an .ics file. */
export { googleCalendarUrl } from '@ap/contracts';

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
