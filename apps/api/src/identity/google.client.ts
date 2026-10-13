import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';

export interface GoogleProfile {
  /** Google's stable account id. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Talks to Google for "Sign in with Google" (OAuth 2.0 authorization code flow). */
@Injectable()
export class GoogleClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET);
  }

  get redirectUri(): string {
    return `${this.config.API_URL.replace(/\/+$/, '')}/auth/google/callback`;
  }

  authorizeUrl(state: string): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.config.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /** Trades the code Google sent back for the person's profile. Throws when Google refuses. */
  async profile(code: string): Promise<GoogleProfile> {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.GOOGLE_CLIENT_ID ?? '',
        client_secret: this.config.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error(`google token exchange failed: ${tokenResponse.status}`);
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
    if (!accessToken) throw new Error('google token exchange returned no access token');
    const userResponse = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!userResponse.ok) throw new Error(`google userinfo failed: ${userResponse.status}`);
    const info = (await userResponse.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    if (!info.sub) throw new Error('google userinfo returned no account id');
    return {
      sub: info.sub,
      email: info.email?.trim().toLowerCase() ?? null,
      emailVerified: info.email_verified === true,
      name: info.name ?? null,
    };
  }
}
