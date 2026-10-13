import { describe, expect, it } from 'vitest';
import { calendarFeedUrls, googleCalendarUrl } from './calendar';

describe('googleCalendarUrl', () => {
  it('opens Google Calendar with the trip in UTC', () => {
    const url = new URL(
      googleCalendarUrl({
        title: 'Delta sunset · Delta Boats',
        startsAt: '2026-10-06T07:00:00.000Z',
        endsAt: '2026-10-06T08:30:00.000Z',
        details: 'Booking ABC123',
        location: 'Pier 3, Tulcea',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261006T070000Z/20261006T083000Z');
    expect(url.searchParams.get('text')).toBe('Delta sunset · Delta Boats');
    expect(url.searchParams.get('location')).toBe('Pier 3, Tulcea');
  });

  it('leaves the location out when there is none', () => {
    const url = new URL(
      googleCalendarUrl({
        title: 'Trip',
        startsAt: '2026-10-06T07:00:00Z',
        endsAt: '2026-10-06T08:00:00Z',
        details: '',
        location: null,
      }),
    );
    expect(url.searchParams.has('location')).toBe(false);
  });
});

describe('calendarFeedUrls', () => {
  it('gives the feed as https, webcal and a Google Calendar subscribe link', () => {
    const urls = calendarFeedUrls('https://api.example.com', 'tok_en-1', 'ro');
    expect(urls.https).toBe('https://api.example.com/public/calendar/tok_en-1.ics?lang=ro');
    expect(urls.webcal).toBe('webcal://api.example.com/public/calendar/tok_en-1.ics?lang=ro');
    const google = new URL(urls.google);
    expect(google.origin + google.pathname).toBe('https://calendar.google.com/calendar/r');
    expect(google.searchParams.get('cid')).toBe(urls.webcal);
  });
});
