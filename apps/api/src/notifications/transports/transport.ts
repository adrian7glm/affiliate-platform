export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Set to show the attachment inline, referenced from the HTML as cid:<contentId>. */
  contentId?: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface OutgoingSms {
  /** E.164 phone number, e.g. +40722123456. */
  to: string;
  text: string;
}

export interface DeliveryReceipt {
  provider: string;
  messageId: string | null;
}

/**
 * A provider rejected or failed a message. `permanent` failures (an invalid number, a rejected
 * address, bad credentials) are not retried; anything else is retried with backoff.
 */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/** Sends email. Implementations: SMTP (any provider), console (development), memory (tests). */
export abstract class EmailTransport {
  abstract readonly name: string;
  abstract send(email: OutgoingEmail): Promise<DeliveryReceipt>;
}

/** Sends SMS. Implementations: Twilio, console (development), memory (tests). */
export abstract class SmsTransport {
  abstract readonly name: string;
  abstract send(sms: OutgoingSms): Promise<DeliveryReceipt>;
}
