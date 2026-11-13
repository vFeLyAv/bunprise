/** @vitest-environment jsdom */
import './test-shims-dom';
import { LazyMotion, domMax } from 'motion/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Card, Checkbox, DateBadge, IconButton, IconTile, OtpField, Page, TextField, TopBar } from './index';
import { Sheet } from './Sheet';

// Wave 1 of the kit ("warm glass on paper", K2/K3/K11): the frosted panels and fields, the glass capsules of
// the top bar, the new small parts (checkbox, code slots, date badge, icon tile) and a sheet that follows a
// pull on its content.

describe('frosted panels and fields', () => {
  it('a Card is a frosted panel (no blur class), an input sits in a frosted field that marks errors', () => {
    render(
      <>
        <Card aria-label="Karte">Inhalt</Card>
        <TextField label="E-Mail" value="" onChange={() => undefined} />
        <TextField label="Titel" value="" error="Bitte gib einen Titel ein" onChange={() => undefined} />
      </>,
    );
    const card = screen.getByLabelText('Karte');
    expect(card.className.split(' ')).toContain('glass-panel');
    expect(card.className).not.toMatch(/glass-(float|bar|sheet)/);
    const box = screen.getByLabelText('E-Mail').parentElement;
    expect(box?.className.split(' ')).toContain('glass-field');
    expect(box?.hasAttribute('data-invalid')).toBe(false);
    expect(screen.getByLabelText('Titel').parentElement?.hasAttribute('data-invalid')).toBe(true);
  });
});

describe('TopBar glass capsules', () => {
  it('the back button and the right actions float as glass from the first frame', () => {
    render(
      <LazyMotion features={domMax} strict>
        <Page
          topBar={
            <TopBar
              title="Anlass"
              back={{ label: 'Zurück', onClick: () => undefined }}
              right={
                <IconButton label="Mehr" variant="plain">
                  …
                </IconButton>
              }
            />
          }
        >
          <p>Inhalt</p>
        </Page>
      </LazyMotion>,
    );
    expect(screen.getByRole('button', { name: 'Zurück' }).className).toContain('glass-float');
    const more = screen.getByRole('button', { name: 'Mehr' });
    expect(more.parentElement?.className).toContain('glass-float');
    // the bar's own material still waits for content under it (scroll edge)
    expect(document.querySelector('header')?.hasAttribute('data-scrolled')).toBe(false);
  });

  it('"Zurück" carries data-tg-back in both forms (Telegram\'s Back button presses it, lib/telegram/bridge.ts)', () => {
    const { unmount } = render(
      <LazyMotion features={domMax} strict>
        <TopBar title="Anlass" back={{ label: 'Zurück', onClick: () => undefined }} />
      </LazyMotion>,
    );
    expect(screen.getByRole('button', { name: 'Zurück' }).hasAttribute('data-tg-back')).toBe(true);
    unmount();
    render(
      <LazyMotion features={domMax} strict>
        <TopBar title="Anlass" back={{ label: 'Zurück', href: '/soon' }} />
      </LazyMotion>,
    );
    expect(screen.getByRole('link', { name: 'Zurück' }).hasAttribute('data-tg-back')).toBe(true);
  });
});

describe('Checkbox', () => {
  it('is a real checkbox with its text as the label; the tick follows the state', () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return (
        <LazyMotion features={domMax} strict>
          <Checkbox checked={on} onChange={setOn}>
            Ich bin mindestens 18 Jahre alt
          </Checkbox>
        </LazyMotion>
      );
    }
    render(<Demo />);
    const box = screen.getByRole('checkbox', { name: 'Ich bin mindestens 18 Jahre alt' });
    expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByText('Ich bin mindestens 18 Jahre alt'));
    expect((box as HTMLInputElement).checked).toBe(true);
  });
});

describe('OtpField', () => {
  it('one real one-time-code input over six slots that show the digits', () => {
    const onChange = vi.fn();
    render(
      <LazyMotion features={domMax} strict>
        <OtpField label="Sechsstelliger Code" value="123" onChange={onChange} />
      </LazyMotion>,
    );
    const input = screen.getByLabelText('Sechsstelliger Code') as HTMLInputElement;
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.maxLength).toBe(6);
    const slots = input.parentElement?.querySelectorAll('.glass-field');
    expect(slots).toHaveLength(6);
    expect([...(slots ?? [])].map((s) => s.textContent)).toEqual(['1', '2', '3', '', '', '']);
    fireEvent.change(input, { target: { value: '1234' } });
    expect(onChange).toHaveBeenCalled();
  });
});

describe('DateBadge and IconTile', () => {
  it('are decorative and take the stable tint / the Paper hue', () => {
    const { container } = render(
      <>
        <DateBadge tone={3} month="OKT" day="23" weekday="Fr" />
        <IconTile tone="lilac">
          <svg />
        </IconTile>
      </>,
    );
    const [badge, tile] = Array.from(container.children) as HTMLElement[];
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(badge?.dataset['tile']).toBe('3');
    expect(badge?.textContent).toBe('OKT23Fr');
    expect(tile?.getAttribute('aria-hidden')).toBe('true');
    expect(tile?.style.backgroundColor).toBe('var(--icon-lilac)');
  });
});

describe('Sheet follows the finger (K11)', () => {
  it('a pull DOWN on its content at the top takes over the touch (no overscroll); a pull up keeps scrolling', () => {
    render(
      <LazyMotion features={domMax} strict>
        <Sheet open onClose={() => undefined} title="Kinogutschein" closeLabel="Schließen">
          <p>Inhalt</p>
        </Sheet>
      </LazyMotion>,
    );
    const content = screen.getByText('Inhalt').parentElement as HTMLElement;
    const pointer = (type: string, y: number) =>
      content.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: y }));
    const touchMove = () => {
      const e = new Event('touchmove', { bubbles: true, cancelable: true });
      content.dispatchEvent(e);
      return e.defaultPrevented;
    };
    // pulling down at the top: after the slop the sheet drags, the browser's scroll is cancelled
    pointer('pointerdown', 300);
    pointer('pointermove', 304);
    expect(touchMove()).toBe(false);
    pointer('pointermove', 320);
    expect(touchMove()).toBe(true);
    pointer('pointerup', 320);
    // pulling up: the content scrolls as usual
    pointer('pointerdown', 300);
    pointer('pointermove', 280);
    expect(touchMove()).toBe(false);
    pointer('pointerup', 280);
  });
});
