import type { TicketDto } from '@ap/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/endpoints', async (orig) => {
  const real = await orig<typeof import('@/lib/endpoints')>();
  return { ...real, publicApi: { ...real.publicApi, ticket: vi.fn() } };
});

import { ApiError } from '@/lib/api';
import { publicApi } from '@/lib/endpoints';
import { TicketView } from './TicketView';

const ticket: TicketDto = {
  bookingReference: 'ABC123',
  status: 'valid',
  productName: 'Boat trip',
  tenantName: 'Op',
  startsAt: '2026-07-01T10:00:00Z',
  endsAt: '2026-07-01T12:00:00Z',
  meetingPoint: null,
  seats: 1,
  items: [{ label: 'Adult', quantity: 1 }],
  customerName: 'Secret Customer',
  qrToken: 'qr-token-xyz-0123456789',
  paymentMode: 'online',
  amountDueOnSiteMinor: 0,
  currency: 'EUR',
  timezone: 'Europe/London',
  branding: {},
  cancellationPolicy: null,
  contactEmail: null,
  contactPhone: null,
  customerNote: null,
};

afterEach(() => {
  localStorage.clear();
  vi.mocked(publicApi.ticket).mockReset();
});

async function renderTicket(ticketKey: string) {
  await act(async () => {
    render(<TicketView bookingId="b1" ticketKey={ticketKey} />);
  });
  await waitFor(() => expect(publicApi.ticket).toHaveBeenCalled());
}

describe('TicketView offline copy', () => {
  it("is not shown for a different key, and that refusal keeps the real holder's copy", async () => {
    localStorage.setItem('ap.ticket.b1', JSON.stringify({ key: 'RIGHT', ticket }));
    vi.mocked(publicApi.ticket).mockRejectedValue(new ApiError(404, 'not_found', 'nope'));
    await renderTicket('WRONG');
    await waitFor(() => expect(screen.queryByText(/Secret Customer/)).toBeNull());
    expect(localStorage.getItem('ap.ticket.b1')).not.toBeNull();
  });

  it('is dropped when the API refuses the same key (booking gone)', async () => {
    localStorage.setItem('ap.ticket.b1', JSON.stringify({ key: 'RIGHT', ticket }));
    vi.mocked(publicApi.ticket).mockRejectedValue(new ApiError(403, 'forbidden', 'nope'));
    await renderTicket('RIGHT');
    await waitFor(() => expect(screen.queryByText(/Secret Customer/)).toBeNull());
    expect(localStorage.getItem('ap.ticket.b1')).toBeNull();
  });

  it('is shown with the same key while offline', async () => {
    localStorage.setItem('ap.ticket.b1', JSON.stringify({ key: 'RIGHT', ticket }));
    vi.mocked(publicApi.ticket).mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    await renderTicket('RIGHT');
    expect(screen.getByText(/Secret Customer/)).toBeTruthy();
    expect(localStorage.getItem('ap.ticket.b1')).not.toBeNull();
  });

  it('is saved together with its key', async () => {
    vi.mocked(publicApi.ticket).mockResolvedValue(ticket);
    await renderTicket('RIGHT');
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('ap.ticket.b1') ?? 'null')).toEqual({
        key: 'RIGHT',
        ticket,
      }),
    );
  });
});
