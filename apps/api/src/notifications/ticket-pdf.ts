import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { type MessageLang, formatMoney, formatWhen } from './templates';

/** Everything printed on a PDF ticket. */
export interface TicketPdfData {
  tenantName: string;
  productName: string;
  reference: string;
  /** ISO date-time of the departure. */
  startsAt: string;
  timezone: string;
  customerName: string;
  meetingPoint: string | null;
  seats: number;
  items?: { label: string; quantity: number }[];
  /** Signed QR payload, the same one the ticket page and email show. */
  qrToken: string;
  amountDueOnSiteMinor: number;
  currency: string;
  /** The online ticket page. */
  url: string;
  /** The ticket was already scanned at boarding. */
  used?: boolean;
  /** Operator brand colour (#rrggbb) for the header band. */
  brandColor?: string | null;
}

/** All words printed on the ticket, per language, so translations live in one place. */
export const TICKET_PDF_TEXT: Record<
  MessageLang,
  {
    ticket: string;
    showAtBoarding: string;
    used: string;
    booking: string;
    customer: string;
    seats: string;
    tickets: string;
    meetingPoint: string;
    dueOnSite: string;
    onlineTicket: string;
    keepOnPhone: string;
  }
> = {
  ro: {
    ticket: 'BILET',
    showAtBoarding: 'Arată acest cod QR la îmbarcare.',
    used: 'Bilet folosit la îmbarcare',
    booking: 'Rezervare',
    customer: 'Client',
    seats: 'Locuri',
    tickets: 'Bilete',
    meetingPoint: 'Punct de întâlnire',
    dueOnSite: 'De plată la îmbarcare',
    onlineTicket: 'Biletul online',
    keepOnPhone: 'Nu trebuie printat: păstrează-l pe telefon.',
  },
  en: {
    ticket: 'TICKET',
    showAtBoarding: 'Show this QR code when you board.',
    used: 'Ticket used at boarding',
    booking: 'Booking',
    customer: 'Name',
    seats: 'Seats',
    tickets: 'Tickets',
    meetingPoint: 'Meeting point',
    dueOnSite: 'To pay at boarding',
    onlineTicket: 'Online ticket',
    keepOnPhone: 'No need to print it: keep it on your phone.',
  },
};

/** DejaVu covers Romanian diacritics and Latin, Greek and Cyrillic customer names. */
const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const DEFAULT_BRAND = '#0e7490';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const WARNING_BG = '#fef3c7';
const WARNING_INK = '#92400e';
const DANGER = '#b91c1c';

/** A phone-shaped page (9:16): reads full-screen on a phone and still prints on one sheet. */
const PAGE = { width: 360, height: 640 };
const MARGIN = 24;
const QR_SIZE = 200;

export function ticketPdfFilename(reference: string): string {
  return `bilet-${reference.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
}

export async function renderTicketPdf(data: TicketPdfData, lang: MessageLang): Promise<Buffer> {
  const t = TICKET_PDF_TEXT[lang];
  const brand = /^#[0-9a-f]{6}$/i.test(data.brandColor ?? '') ? data.brandColor! : DEFAULT_BRAND;
  const qrPng = await QRCode.toBuffer(data.qrToken, {
    type: 'png',
    width: QR_SIZE * 3,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: MARGIN,
    info: {
      Title: `${t.ticket} ${data.reference} · ${data.productName}`,
      Author: data.tenantName,
      Subject: data.productName,
    },
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = PAGE.width - MARGIN * 2;

  // Header band: operator name and the word "ticket".
  doc.rect(0, 0, PAGE.width, 70).fill(brand);
  doc
    .fillColor('#ffffff')
    .font('bold')
    .fontSize(9)
    .text(t.ticket, MARGIN, 18, { width, characterSpacing: 2 });
  doc.font('bold').fontSize(17).text(data.tenantName, MARGIN, 32, {
    width,
    height: 26,
    ellipsis: true,
  });

  // Trip and departure.
  doc.y = 88;
  doc.fillColor(INK).font('bold').fontSize(16).text(data.productName, MARGIN, doc.y, { width });
  doc.moveDown(0.2);
  doc
    .font('regular')
    .fontSize(12)
    .text(formatWhen(data.startsAt, data.timezone, lang), { width });

  // QR code.
  const qrTop = doc.y + 14;
  const qrLeft = (PAGE.width - QR_SIZE) / 2;
  doc
    .roundedRect(qrLeft - 8, qrTop - 8, QR_SIZE + 16, QR_SIZE + 16, 10)
    .lineWidth(1)
    .strokeColor(LINE)
    .stroke();
  doc.image(qrPng, qrLeft, qrTop, { width: QR_SIZE, height: QR_SIZE });
  doc.y = qrTop + QR_SIZE + 16;
  doc
    .font('bold')
    .fontSize(11)
    .fillColor(data.used ? DANGER : INK)
    .text(data.used ? t.used : t.showAtBoarding, MARGIN, doc.y, { width, align: 'center' });
  doc.moveDown(0.8);

  // Details.
  const rows: [string, string][] = [
    [t.booking, data.reference],
    [t.customer, data.customerName],
    [t.seats, String(data.seats)],
  ];
  const items = (data.items ?? []).filter((i) => i.quantity > 0);
  if (items.length > 0) {
    rows.push([t.tickets, items.map((i) => `${i.quantity} × ${i.label}`).join(', ')]);
  }
  if (data.meetingPoint) rows.push([t.meetingPoint, data.meetingPoint]);
  const labelWidth = 104;
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.font('regular').fontSize(10).fillColor(MUTED).text(label, MARGIN, y, { width: labelWidth });
    doc
      .font('bold')
      .fontSize(11)
      .fillColor(INK)
      .text(value, MARGIN + labelWidth, y - 1, { width: width - labelWidth });
    doc.y = Math.max(doc.y, y + 14) + 5;
  }

  if (data.amountDueOnSiteMinor > 0) {
    const y = doc.y + 4;
    doc.roundedRect(MARGIN, y, width, 40, 8).fill(WARNING_BG);
    doc
      .fillColor(WARNING_INK)
      .font('regular')
      .fontSize(10)
      .text(t.dueOnSite, MARGIN + 12, y + 7, { width: width - 24 });
    doc
      .font('bold')
      .fontSize(13)
      .text(formatMoney(data.amountDueOnSiteMinor, data.currency, lang), MARGIN + 12, y + 20, {
        width: width - 24,
      });
    doc.y = y + 50;
  }

  // Footer: link to the live ticket, pinned to the bottom when there is room.
  const footerTop = Math.max(doc.y + 8, PAGE.height - MARGIN - 44);
  doc
    .moveTo(MARGIN, footerTop)
    .lineTo(PAGE.width - MARGIN, footerTop)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke();
  doc
    .font('regular')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(t.keepOnPhone, MARGIN, footerTop + 8, { width });
  doc
    .fillColor(brand)
    .text(`${t.onlineTicket}: ${data.url}`, { width, link: data.url, underline: false });

  doc.end();
  return done;
}
