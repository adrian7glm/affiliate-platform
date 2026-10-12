import { API_URL } from './api';

/**
 * API base URL for code running on the Next.js server (route handlers, server components).
 * `API_INTERNAL_URL` lets the server reach the API on a private address (e.g. in Docker).
 */
export const SERVER_API_URL = (process.env.API_INTERNAL_URL || API_URL).replace(/\/+$/, '');
