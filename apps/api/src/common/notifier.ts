import { Logger } from '@nestjs/common';

export interface Notification {
  to: string;
  subject: string;
  text: string;
}

/** Sends SMS or email. Real providers (Twilio, Resend) plug in behind this interface. */
export abstract class Notifier {
  abstract send(notification: Notification): Promise<void>;
}

export class ConsoleNotifier extends Notifier {
  private readonly logger = new Logger('Notifier');
  async send(notification: Notification): Promise<void> {
    this.logger.log(`to ${notification.to} | ${notification.subject} | ${notification.text}`);
  }
}

export class MemoryNotifier extends Notifier {
  readonly sent: Notification[] = [];
  async send(notification: Notification): Promise<void> {
    this.sent.push(notification);
  }
  last(to: string): Notification | undefined {
    return this.sent.filter((n) => n.to === to).at(-1);
  }
}
