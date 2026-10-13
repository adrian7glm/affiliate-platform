import type { BookingQuestionDto, DeparturePassengersDto, PassengerDto } from '@ap/contracts';
import { describe, expect, it } from 'vitest';
import { getT } from './i18n';
import { answerLabel, answersText, itemsText, markBoarded, passengerMatches } from './passengers';
import { missingAnswers, toAnswers } from './questions';
import {
  newQuestionId,
  parseOptions,
  translatedLanguages,
  translationProgress,
} from './tripTranslations';

const lunch: BookingQuestionDto = {
  id: 'lunch1',
  label: 'Lunch',
  kind: 'choice',
  required: true,
  options: [
    { value: 'Fish', label: 'Fish' },
    { value: 'Vegetarian', label: 'Vegetarian' },
  ],
};
const hotel: BookingQuestionDto = {
  id: 'hotel1',
  label: 'Hotel',
  kind: 'text',
  required: false,
  options: [],
};

describe('booking questions', () => {
  it('lists required questions left empty and sends only what was answered', () => {
    expect(missingAnswers([lunch, hotel], {})).toEqual(['lunch1']);
    expect(missingAnswers([lunch, hotel], { lunch1: '  ' })).toEqual(['lunch1']);
    expect(missingAnswers([lunch, hotel], { lunch1: 'Fish' })).toEqual([]);
    expect(toAnswers([lunch, hotel], { lunch1: 'Fish', hotel1: ' ' })).toEqual([
      { questionId: 'lunch1', value: 'Fish' },
    ]);
  });

  it('reads choices one per line, without blanks or repeats', () => {
    expect(parseOptions(' Fish\n\nChicken \nfish\nVegetarian\n')).toEqual([
      'Fish',
      'Chicken',
      'Vegetarian',
    ]);
  });

  it('makes question ids the API accepts', () => {
    let i = 0;
    const id = newQuestionId(() => (i++ % 36) / 36);
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(newQuestionId()).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe('trip translations', () => {
  const product = {
    description: 'Two hours along the coast',
    meetingPoint: null,
    customerNote: 'Come early',
    prices: [
      { id: 'p1', code: 'adult', label: 'Adult', amountMinor: 1000, taxRateBps: 0, seats: 1 },
    ],
    questions: [lunch],
  };

  it('counts the texts a language covers', () => {
    // name, description, note, one ticket, the question and its two choices
    expect(translationProgress(product, undefined)).toEqual({ done: 0, total: 7 });
    expect(
      translationProgress(product, {
        name: 'Bootsfahrt',
        description: ' ',
        prices: { p1: 'Erwachsener' },
        questions: { lunch1: { label: 'Mittagessen', options: ['Fisch', 'Vegetarisch'] } },
      }),
    ).toEqual({ done: 5, total: 7 });
  });

  it('does not count choices that no longer match the list', () => {
    expect(
      translationProgress(product, { questions: { lunch1: { options: ['Fisch'] } } }).done,
    ).toBe(0);
  });

  it('names the languages that have any translation', () => {
    expect(
      translatedLanguages({
        translations: { fr: { name: 'Sortie' }, de: { prices: { p1: 'Erwachsener' } }, it: {} },
      }),
    ).toEqual(['de', 'fr']);
    expect(translatedLanguages({})).toEqual([]);
  });
});

describe('passenger list', () => {
  const passenger: PassengerDto = {
    bookingId: 'b1',
    reference: 'AB12CD',
    status: 'confirmed',
    customerName: 'Ana Pop',
    customerPhone: '+40722123456',
    customerEmail: null,
    customerLocale: 'ro',
    hotelRoom: '214',
    seats: 3,
    items: [
      { label: 'Adult', quantity: 2 },
      { label: 'Child', quantity: 1 },
    ],
    paymentMode: 'on_site',
    amountDueMinor: 25000,
    currency: 'RON',
    affiliateName: 'Hotel Mara',
    answers: [{ questionId: 'lunch1', label: 'Lunch', value: 'Fish' }],
    boardedAt: null,
  };
  const list: DeparturePassengersDto = {
    departure: {
      slotId: 's1',
      productId: 'p1',
      productName: 'Sunset trip',
      startsAt: '2026-10-13T16:00:00.000Z',
      endsAt: '2026-10-13T18:00:00.000Z',
      capacity: 40,
      closed: false,
      seatsBooked: 3,
      seatsBoarded: 0,
      bookings: 1,
      pendingPayment: 0,
    },
    timezone: 'Europe/Bucharest',
    passengers: [passenger],
  };

  it('finds a passenger by name, reference, room or affiliate', () => {
    expect(passengerMatches(passenger, 'ana', 'ro')).toBe(true);
    expect(passengerMatches(passenger, 'ab12', 'ro')).toBe(true);
    expect(passengerMatches(passenger, '214', 'ro')).toBe(true);
    expect(passengerMatches(passenger, 'mara', 'ro')).toBe(true);
    expect(passengerMatches(passenger, 'ion', 'ro')).toBe(false);
    expect(passengerMatches(passenger, ' ', 'ro')).toBe(true);
  });

  it('boards a passenger once: their seats count and nothing is left to collect', () => {
    const boarded = markBoarded(list, 'b1', '2026-10-13T15:55:00.000Z');
    expect(boarded.departure.seatsBoarded).toBe(3);
    expect(boarded.passengers[0]).toMatchObject({
      boardedAt: '2026-10-13T15:55:00.000Z',
      amountDueMinor: 0,
    });
    expect(markBoarded(boarded, 'b1', '2026-10-13T15:58:00.000Z')).toBe(boarded);
    expect(markBoarded(list, 'nope', '2026-10-13T15:58:00.000Z')).toBe(list);
  });

  it('writes tickets and answers on one line for the CSV', () => {
    expect(itemsText(passenger.items)).toBe('2 × Adult, 1 × Child');
    expect(answersText(passenger.answers)).toBe('Lunch: Fish');
    expect(
      answersText([
        { questionId: 'a', label: 'Which menu?', value: 'Fish' },
        { questionId: 'b', label: 'Hotel ', value: 'Mara' },
      ]),
    ).toBe('Which menu? Fish; Hotel: Mara');
    expect(answerLabel('Pickup:')).toBe('Pickup:');
  });

  it('counts what is left to board in every language form', () => {
    const ro = getT('ro');
    expect(ro.tp('operator.departures.toBoard', 1)).toBe('O rezervare mai are de urcat la bord');
    expect(ro.tp('operator.departures.toBoard', 3)).toBe('3 rezervări mai au de urcat la bord');
    expect(ro.tp('operator.departures.toBoard', 21)).toBe(
      '21 de rezervări mai au de urcat la bord',
    );
    expect(getT('en').tp('operator.departures.toBoard', 2)).toBe('2 bookings still to board');
  });
});
