import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('accepts apps/api/.env.example as shipped (the README tells people to copy it)', () => {
    const example = parseEnv(readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8'));
    expect(() => loadConfig(example)).not.toThrow();
  });

  it('treats an empty LOG_FORMAT as unset', () => {
    expect(
      loadConfig({ DATABASE_URL: 'postgres://x', APP_SECRET: 'x'.repeat(32), LOG_FORMAT: '' })
        .LOG_FORMAT,
    ).toBeUndefined();
  });
});
