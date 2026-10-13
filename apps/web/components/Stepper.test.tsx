import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from './I18nProvider';
import { Stepper } from './Stepper';

function Harness({ max = 3 }: { max?: number }) {
  const [value, setValue] = useState(0);
  return (
    <Stepper
      label="Adult"
      value={value}
      onChange={setValue}
      min={0}
      max={max}
      decreaseLabel="Scoate un adult"
      increaseLabel="Adaugă un adult"
    />
  );
}

describe('Stepper', () => {
  it('counts up and down within bounds', () => {
    render(<Harness max={2} />);
    const value = screen.getByTestId('stepper-value');
    const plus = screen.getByRole('button', { name: 'Adaugă un adult' });
    const minus = screen.getByRole('button', { name: 'Scoate un adult' });

    expect(value.textContent).toBe('0');
    expect((minus as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(value.textContent).toBe('2');
    expect((plus as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(minus);
    expect(value.textContent).toBe('1');
  });

  it('names its buttons in the page language by default', () => {
    render(
      <I18nProvider lang="en" languages={[]} overrides={{}}>
        <Stepper label="Child" value={1} onChange={() => undefined} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Increase Child' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decrease Child' })).toBeTruthy();
  });
});
