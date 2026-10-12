import { Logger } from '@nestjs/common';
import {
  type DeliveryReceipt,
  DeliveryError,
  EmailTransport,
  type OutgoingEmail,
  type OutgoingSms,
  SmsTransport,
} from './transport';

/** Development: prints messages in the API log, so login codes work without any account. */
export class ConsoleEmailTransport extends EmailTransport {
  readonly name = 'console';
  private readonly logger = new Logger('Email');
  async send(email: OutgoingEmail): Promise<DeliveryReceipt> {
    this.logger.log(`to ${email.to} | ${email.subject}\n${email.text}`);
    return { provider: this.name, messageId: null };
  }
}

export class ConsoleSmsTransport extends SmsTransport {
  readonly name = 'console';
  private readonly logger = new Logger('SMS');
  async send(sms: OutgoingSms): Promise<DeliveryReceipt> {
    this.logger.log(`to ${sms.to} | ${sms.text}`);
    return { provider: this.name, messageId: null };
  }
}

/** The channel is turned off: messages to it fail permanently instead of being retried. */
export class DisabledEmailTransport extends EmailTransport {
  readonly name = 'disabled';
  async send(): Promise<DeliveryReceipt> {
    throw new DeliveryError('email delivery is not configured', true);
  }
}

export class DisabledSmsTransport extends SmsTransport {
  readonly name = 'disabled';
  async send(): Promise<DeliveryReceipt> {
    throw new DeliveryError('SMS delivery is not configured', true);
  }
}

export interface SentMessage {
  channel: 'email' | 'sms';
  to: string;
  subject: string | null;
  text: string;
  html: string | null;
  attachments: OutgoingEmail['attachments'];
}

/** Tests: keeps every message in memory. One instance serves as both transports. */
export class MemoryTransport {
  readonly sent: SentMessage[] = [];
  /** Makes the next sends fail, to test retries. */
  failNext: DeliveryError[] = [];

  readonly email: EmailTransport = new (class extends EmailTransport {
    readonly name = 'memory';
    constructor(private readonly outer: MemoryTransport) {
      super();
    }
    async send(email: OutgoingEmail): Promise<DeliveryReceipt> {
      this.outer.take();
      this.outer.sent.push({
        channel: 'email',
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments,
      });
      return { provider: this.name, messageId: `mem-${this.outer.sent.length}` };
    }
  })(this);

  readonly sms: SmsTransport = new (class extends SmsTransport {
    readonly name = 'memory';
    constructor(private readonly outer: MemoryTransport) {
      super();
    }
    async send(sms: OutgoingSms): Promise<DeliveryReceipt> {
      this.outer.take();
      this.outer.sent.push({
        channel: 'sms',
        to: sms.to,
        subject: null,
        text: sms.text,
        html: null,
        attachments: undefined,
      });
      return { provider: this.name, messageId: `mem-${this.outer.sent.length}` };
    }
  })(this);

  last(to: string): SentMessage | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }

  private take(): void {
    const error = this.failNext.shift();
    if (error) throw error;
  }
}
