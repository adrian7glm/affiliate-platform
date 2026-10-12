import { type DeliveryReceipt, DeliveryError, type OutgoingSms, SmsTransport } from './transport';

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  /** A Twilio number or an alphanumeric sender ID (e.g. "DeltaBoats"). */
  from?: string;
  /** Used instead of `from` when set: Twilio picks the sender from the service's pool. */
  messagingServiceSid?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

/** SMS through Twilio's REST API. No SDK: one form-encoded POST per message. */
export class TwilioSmsTransport extends SmsTransport {
  readonly name = 'twilio';
  private readonly fetch: typeof fetch;

  constructor(private readonly options: TwilioOptions) {
    super();
    if (!options.from && !options.messagingServiceSid) {
      throw new Error('Twilio needs TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');
    }
    this.fetch = options.fetch ?? fetch;
  }

  async send(sms: OutgoingSms): Promise<DeliveryReceipt> {
    const { accountSid, authToken, from, messagingServiceSid } = this.options;
    const base = this.options.apiUrl ?? 'https://api.twilio.com';
    const body = new URLSearchParams({ To: sms.to, Body: sms.text });
    if (messagingServiceSid) body.set('MessagingServiceSid', messagingServiceSid);
    else body.set('From', from!);

    let response: Response;
    try {
      response = await this.fetch(`${base}/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new DeliveryError(`twilio: ${(error as Error).message}`, false);
    }
    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      code?: number;
      message?: string;
    };
    if (!response.ok) {
      // 4xx is about this message (invalid or unreachable number, opted out); 401, 429 and 5xx
      // are about the account or Twilio itself and are worth retrying.
      const permanent =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 401 &&
        response.status !== 429;
      throw new DeliveryError(
        `twilio ${response.status}${payload.code ? ` (${payload.code})` : ''}: ${payload.message ?? response.statusText}`,
        permanent,
      );
    }
    return { provider: this.name, messageId: payload.sid ?? null };
  }
}
