import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { Translator } from '@ap/i18n';
import { formatMoney, formatWhen } from './templates';

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
  /** The operator's message for the trip's customers. */
  customerNote?: string | null;
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
const NOTE_MAX_CHARS = 240;

export function ticketPdfFilename(reference: string, tr: Translator): string {
  return tr.t('email.ticketPdf.fileName', { reference: reference.replace(/[^A-Za-z0-9-]/g, '') });
}

/** Words come from `email.ticketPdf.*` in the language files. */
export async function renderTicketPdf(data: TicketPdfData, tr: Translator): Promise<Buffer> {
  const word = (key: string) => tr.tk(`email.ticketPdf.${key}`);
  const t = {
    ticket: word('ticket'),
    showAtBoarding: word('showAtBoarding'),
    used: word('used'),
    booking: word('booking'),
    customer: word('customer'),
    seats: word('seats'),
    tickets: word('tickets'),
    meetingPoint: word('meetingPoint'),
    note: word('note'),
    dueOnSite: word('dueOnSite'),
    onlineTicket: word('onlineTicket'),
    keepOnPhone: word('keepOnPhone'),
  };
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
    .text(formatWhen(data.startsAt, data.timezone, tr), { width });

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

  if (data.customerNote) {
    // The page is phone-sized: a long message is cut here, the online ticket shows all of it.
    const note =
      data.customerNote.length > NOTE_MAX_CHARS
        ? `${data.customerNote.slice(0, NOTE_MAX_CHARS - 1).trimEnd()}…`
        : data.customerNote;
    doc
      .font('regular')
      .fontSize(10)
      .fillColor(MUTED)
      .text(t.note, MARGIN, doc.y + 2, { width });
    doc
      .font('regular')
      .fontSize(9.5)
      .fillColor(INK)
      .text(note, MARGIN, doc.y + 1, { width });
    doc.y += 6;
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
      .text(formatMoney(data.amountDueOnSiteMinor, data.currency, tr.lang), MARGIN + 12, y + 20, {
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
