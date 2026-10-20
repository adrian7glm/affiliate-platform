import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider, useT } from './I18nProvider';

function Probe() {
  const { t, lang } = useT();
  return <p data-testid="probe">{`${lang}:${t('common.retry')}`}</p>;
}

describe('I18nProvider with a fixed language', () => {
  it("follows the server's overrides when the language changes without a remount", () => {
    const { rerender } = render(
      <I18nProvider lang="en" languages={[]} overrides={{ 'common.retry': 'EN CUSTOM' }}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('en:EN CUSTOM');

    rerender(
      <I18nProvider lang="ro" languages={[]} overrides={{ 'common.retry': 'RO CUSTOM' }}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('ro:RO CUSTOM');
  });
});
