import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Loads apps/api/.env for local runs. Variables already set in the environment win, so
 * production and CI configure the API through real environment variables only.
 */
export function loadDotEnv(file = path.resolve(__dirname, '../.env')): void {
  if (!existsSync(file)) return;
  const values = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
