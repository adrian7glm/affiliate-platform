import type { DeparturePassengersDto, PassengerDto } from '@ap/contracts';

/** Search on the boarding list: name, booking reference, hotel room, phone or affiliate. */
export function passengerMatches(passenger: PassengerDto, query: string, locale: string): boolean {
  const q = query.trim().toLocaleLowerCase(locale);
  if (!q) return true;
  return [
    passenger.customerName,
    passenger.reference,
    passenger.hotelRoom ?? '',
    passenger.customerPhone ?? '',
    passenger.affiliateName ?? '',
  ]
    .join(' ')
    .toLocaleLowerCase(locale)
    .includes(q);
}

/** The list after a passenger was boarded by hand: their time, and the departure's count. */
export function markBoarded(
  list: DeparturePassengersDto,
  bookingId: string,
  boardedAt: string,
): DeparturePassengersDto {
  const passenger = list.passengers.find((p) => p.bookingId === bookingId);
  if (!passenger || passenger.boardedAt) return list;
  return {
    ...list,
    departure: {
      ...list.departure,
      seatsBoarded: list.departure.seatsBoarded + passenger.seats,
    },
    passengers: list.passengers.map((p) =>
      p.bookingId === bookingId ? { ...p, boardedAt, amountDueMinor: 0 } : p,
    ),
  };
}

/** "2 × Adult, 1 × Child" */
export function itemsText(items: PassengerDto['items']): string {
  return items.map((i) => `${i.quantity} × ${i.label}`).join(', ');
}

/** A question as a label before its answer: "Lunch:", but "Which menu?" stays as it is. */
export function answerLabel(label: string): string {
  return /[?:!]$/.test(label.trim()) ? label.trim() : `${label.trim()}:`;
}

/** "Lunch: Vegetarian; Which menu? Fish" */
export function answersText(answers: PassengerDto['answers']): string {
  return answers.map((a) => `${answerLabel(a.label)} ${a.value}`).join('; ');
}
