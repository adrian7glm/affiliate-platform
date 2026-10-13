import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, notifications } from '@ap/db';
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { Clock } from '../common/clock';
import { DomainError } from '../common/errors';
import { DB, type DbOrTx } from '../database/database.module';
import { I18nService } from '../i18n/i18n.service';
import { QR_CONTENT_ID, type TemplateName, type TemplateParams, render } from './templates';
import { renderTicketPdf, ticketPdfFilename } from './ticket-pdf';
import {
  type DeliveryReceipt,
  DeliveryError,
  type EmailAttachment,
  EmailTransport,
  SmsTransport,
} from './transports/transport';

export interface Message<T extends TemplateName = TemplateName> {
  /** An email address or an E.164 phone number; the channel follows from it. */
  to: string;
  template: T;
  locale: string;
  params: TemplateParams[T];
  tenantId?: string | null;
  /** Enqueueing twice with the same key sends one message. */
  dedupeKey?: string;
}

type NotificationRow = typeof notifications.$inferSelect;

export const MAX_ATTEMPTS = 6;
/** Wait before attempt n+1 after attempt n failed. */
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3_600_000];
/** A message being sent is retried after this long if its worker died mid-send. */
const LEASE_MS = 5 * 60_000;
const BATCH = 25;

export const channelOf = (to: string): 'email' | 'sms' => (to.includes('@') ? 'email' : 'sms');

/**
 * Sends SMS and email. Other modules decide what to send and when; this module renders the
 * templates, picks the channel from the recipient, and owns delivery and retries.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  private delivering: Promise<number> | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly email: EmailTransport,
    private readonly sms: SmsTransport,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Queues a message in the caller's transaction: it is sent only if the transaction commits,
   * by the worker, with retries.
   */
  async enqueue<T extends TemplateName>(tx: DbOrTx, message: Message<T>): Promise<void> {
    await tx
      .insert(notifications)
      .values({
        tenantId: message.tenantId ?? null,
        channel: channelOf(message.to),
        recipient: message.to,
        template: message.template,
        locale: message.locale,
        params: message.params,
        dedupeKey: message.dedupeKey ?? null,
        nextAttemptAt: this.clock.now(),
      })
      .onConflictDoNothing();
  }

  /**
   * Sends right away and reports failure to the caller, for messages someone is waiting for
   * (login codes). The log row keeps no parameters, so codes are never stored.
   */
  async sendNow<T extends TemplateName>(message: Message<T>): Promise<void> {
    const now = this.clock.now();
    const channel = channelOf(message.to);
    const base = {
      tenantId: message.tenantId ?? null,
      channel,
      recipient: message.to,
      template: message.template,
      locale: message.locale,
      params: {},
      attempts: 1,
      nextAttemptAt: now,
    };
    try {
      const receipt = await this.deliver(
        channel,
        message.to,
        message.template,
        message.locale,
        message.params,
      );
      await this.db.insert(notifications).values({
        ...base,
        status: 'sent',
        provider: receipt.provider,
        providerMessageId: receipt.messageId,
        sentAt: now,
      });
    } catch (error) {
      const failure = asDeliveryError(error);
      this.logger.error(`${message.template} to ${mask(message.to)} failed: ${failure.message}`);
      await this.db
        .insert(notifications)
        .values({ ...base, status: 'failed', lastError: failure.message });
      throw failure.permanent
        ? new DomainError(
            'errors.notifications.invalidRecipient',
            HttpStatus.BAD_REQUEST,
            undefined,
            {
              to: message.to,
            },
          )
        : new DomainError('errors.notifications.unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /** Sends every queued message that is due. Concurrent calls share one run. */
  deliverDue(): Promise<number> {
    if (!this.delivering) {
      this.delivering = this.deliverAll().finally(() => {
        this.delivering = null;
      });
    }
    return this.delivering;
  }

  private async deliverAll(): Promise<number> {
    let sent = 0;
    for (let round = 0; round < 40; round += 1) {
      const batch = await this.claim();
      if (!batch.length) break;
      for (const row of batch) {
        if (await this.deliverRow(row)) sent += 1;
      }
    }
    return sent;
  }

  /** Takes due messages for this worker: concurrent workers never take the same one. */
  private async claim(): Promise<NotificationRow[]> {
    const now = this.clock.now();
    // A worker died after its last allowed attempt: give up on those.
    await this.db
      .update(notifications)
      .set({
        status: 'failed',
        lastError: sql`coalesce(${notifications.lastError}, 'worker stopped while sending')`,
      })
      .where(
        and(
          eq(notifications.status, 'sending'),
          gte(notifications.attempts, MAX_ATTEMPTS),
          lte(notifications.nextAttemptAt, now),
        ),
      );
    const due = this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          inArray(notifications.status, ['queued', 'sending']),
          lte(notifications.nextAttemptAt, now),
          lt(notifications.attempts, MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(notifications.nextAttemptAt), asc(notifications.createdAt))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    const claimed = await this.db
      .update(notifications)
      .set({
        status: 'sending',
        attempts: sql`${notifications.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(inArray(notifications.id, due))
      .returning();
    // UPDATE ... RETURNING has no order: send in the order the messages were created.
    return claimed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  private async deliverRow(row: NotificationRow): Promise<boolean> {
    try {
      const receipt = await this.deliver(
        row.channel,
        row.recipient,
        row.template as TemplateName,
        row.locale,
        row.params as TemplateParams[TemplateName],
      );
      await this.db
        .update(notifications)
        .set({
          status: 'sent',
          sentAt: this.clock.now(),
          provider: receipt.provider,
          providerMessageId: receipt.messageId,
          lastError: null,
        })
        .where(eq(notifications.id, row.id));
      return true;
    } catch (error) {
      const failure = asDeliveryError(error);
      const final = failure.permanent || row.attempts >= MAX_ATTEMPTS;
      const wait = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)]!;
      this.logger.error(
        `${row.template} ${row.id} to ${mask(row.recipient)} failed (attempt ${row.attempts}${final ? ', giving up' : ''}): ${failure.message}`,
      );
      await this.db
        .update(notifications)
        .set({
          status: final ? 'failed' : 'queued',
          lastError: failure.message,
          nextAttemptAt: new Date(this.clock.now().getTime() + (final ? 0 : wait)),
        })
        .where(eq(notifications.id, row.id));
      return false;
    }
  }

  private async deliver(
    channel: 'email' | 'sms',
    to: string,
    template: TemplateName,
    locale: string,
    params: TemplateParams[TemplateName],
  ): Promise<DeliveryReceipt> {
    // Any language the platform offers; English when the recipient's is not offered.
    const t = this.i18n.translator(this.i18n.pick(locale, 'en'));
    const message = render(template, t, params);
    if (channel === 'sms') return this.sms.send({ to, text: message.sms });
    const attachments: EmailAttachment[] = [];
    if (message.qr) {
      attachments.push({
        filename: message.qrFileName,
        contentType: 'image/png',
        contentId: QR_CONTENT_ID,
        content: await QRCode.toBuffer(message.qr, {
          type: 'png',
          width: 440,
          margin: 2,
          errorCorrectionLevel: 'M',
        }),
      });
    }
    if (template === 'ticket' && message.qr) {
      // The same ticket as a PDF, so the customer can keep it on the phone without printing.
      const ticket = params as TemplateParams['ticket'];
      attachments.push({
        filename: ticketPdfFilename(ticket.reference, t),
        contentType: 'application/pdf',
        content: await renderTicketPdf({ ...ticket, qrToken: message.qr }, t),
      });
    }
    return this.email.send({
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  }
}

function asDeliveryError(error: unknown): DeliveryError {
  return error instanceof DeliveryError
    ? error
    : new DeliveryError((error as Error)?.message ?? String(error), false);
}

/** Keeps logs useful without printing whole phone numbers or addresses. */
export function mask(to: string): string {
  if (to.includes('@')) {
    const [user, domain] = to.split('@');
    return `${user!.slice(0, 2)}***@${domain}`;
  }
  return `${to.slice(0, 4)}***${to.slice(-3)}`;
}
