import nodemailer, { type Transporter } from 'nodemailer';
import {
  type DeliveryReceipt,
  DeliveryError,
  EmailTransport,
  type OutgoingEmail,
} from './transport';

/**
 * Email over SMTP, which every provider offers (Resend, Amazon SES, Brevo, Mailgun, Postmark,
 * Google Workspace...), so switching provider is a configuration change.
 * SMTP_URL looks like smtps://user:password@smtp.example.com:465.
 */
export class SmtpEmailTransport extends EmailTransport {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {
    super();
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(email: OutgoingEmail): Promise<DeliveryReceipt> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        replyTo: this.replyTo,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          cid: a.contentId,
        })),
      });
      return { provider: this.name, messageId: info.messageId ?? null };
    } catch (error) {
      throw smtpError(error);
    }
  }
}

/** 5xx answers about the message or recipient are final; connection, auth and 4xx are retried. */
export function smtpError(error: unknown): DeliveryError {
  const e = error as { message?: string; code?: string; responseCode?: number };
  const permanent =
    e.code === 'EENVELOPE' ||
    (e.code === 'EMESSAGE' && (e.responseCode ?? 0) >= 500) ||
    (typeof e.responseCode === 'number' && e.responseCode >= 550 && e.responseCode <= 554);
  return new DeliveryError(`smtp: ${e.message ?? String(error)}`, permanent);
}
