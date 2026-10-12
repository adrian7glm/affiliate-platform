import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { NotificationsService } from './notifications.service';
import {
  ConsoleEmailTransport,
  ConsoleSmsTransport,
  DisabledEmailTransport,
  DisabledSmsTransport,
} from './transports/dev';
import { SmtpEmailTransport } from './transports/smtp';
import { EmailTransport, SmsTransport } from './transports/transport';
import { TwilioSmsTransport } from './transports/twilio';

export function emailTransportFor(config: AppConfig): EmailTransport {
  switch (config.EMAIL_PROVIDER) {
    case 'smtp':
      return new SmtpEmailTransport(
        config.SMTP_URL!,
        config.EMAIL_FROM,
        config.EMAIL_REPLY_TO || undefined,
      );
    case 'disabled':
      return new DisabledEmailTransport();
    default:
      return new ConsoleEmailTransport();
  }
}

export function smsTransportFor(config: AppConfig): SmsTransport {
  switch (config.SMS_PROVIDER) {
    case 'twilio':
      return new TwilioSmsTransport({
        accountSid: config.TWILIO_ACCOUNT_SID!,
        authToken: config.TWILIO_AUTH_TOKEN!,
        from: config.TWILIO_FROM || undefined,
        messagingServiceSid: config.TWILIO_MESSAGING_SERVICE_SID || undefined,
      });
    case 'disabled':
      return new DisabledSmsTransport();
    default:
      return new ConsoleSmsTransport();
  }
}

/** SMS and email: templates, delivery queue and providers, chosen by EMAIL_PROVIDER and SMS_PROVIDER. */
@Global()
@Module({
  providers: [
    { provide: EmailTransport, inject: [APP_CONFIG], useFactory: emailTransportFor },
    { provide: SmsTransport, inject: [APP_CONFIG], useFactory: smsTransportFor },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
