/** @vitest-environment jsdom */
import './test-shims-dom';
import { LazyMotion, domMax } from 'motion/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, TextField } from './index';
import { Sheet } from './Sheet';
import { ToastProvider, useToast } from './Toast';

describe('ui kit smoke', () => {
  it('Button: loading keeps the label for width, sets aria-busy and disables', () => {
    render(<Button loading loadingLabel="Lädt">Speichern</Button>);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Speichern');
    expect(screen.getByRole('progressbar', { name: 'Lädt' })).toBeTruthy();
  });

  it('TextField: error is announced via aria-invalid + aria-describedby', () => {
    render(<TextField label="E-Mail" error="Keine gültige Adresse" value="" onChange={() => undefined} />);
    const input = screen.getByLabelText('E-Mail') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const descId = input.getAttribute('aria-describedby');
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId ?? '')?.textContent).toContain('Keine gültige Adresse');
  });

  it('Sheet: modal dialog, background inert, Escape closes', async () => {
    const onClose = vi.fn();
    render(
      <LazyMotion features={domMax} strict>
        <div data-testid="app">app</div>
        <Sheet open onClose={onClose} title="Titel" closeLabel="Schließen">
          <button type="button">innen</button>
        </Sheet>
      </LazyMotion>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Titel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeTruthy();
    // Everything outside the sheet (the RTL container) is inert while it is open.
    const container = screen.getByTestId('app').parentElement;
    expect(container?.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Toast: show() renders a status, the action dismisses it', async () => {
    const undo = vi.fn();
    function Demo() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast.success('Gespeichert', { action: { label: 'Rückgängig', onClick: undo } })}>
          go
        </button>
      );
    }
    render(
      <LazyMotion features={domMax} strict>
        <ToastProvider>
          <Demo />
        </ToastProvider>
      </LazyMotion>,
    );
    fireEvent.click(screen.getByText('go'));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Gespeichert');
    fireEvent.click(screen.getByText('Rückgängig'));
    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 3000 });
  });

  it('Sheet: Escape belongs to the top sheet, and to an expanded control before its sheet', () => {
    const outerClose = vi.fn(), innerClose = vi.fn(), controlClose = vi.fn();
    render(<LazyMotion features={domMax} strict>
      <Sheet open title="Outer" closeLabel="Close outer" onClose={outerClose}><p>Outer content</p></Sheet>
      <Sheet open title="Inner" closeLabel="Close inner" onClose={innerClose}>
        <button type="button" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); controlClose(); } }}>Calendar</button>
      </Sheet>
    </LazyMotion>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Calendar' }), { key: 'Escape' });
    expect(controlClose).toHaveBeenCalledTimes(1);
    expect(innerClose).not.toHaveBeenCalled();
    expect(outerClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('Sheet: closing the covered sheet keeps the top sheet interactive and background locked', () => {
    const topClose = vi.fn();
    const sheets = (lower: boolean) => <LazyMotion features={domMax} strict>
      <div data-testid="background">Background</div>
      <Sheet open={lower} title="Lower" closeLabel="Close lower" onClose={() => {}}>Lower</Sheet>
      <Sheet open title="Upper" closeLabel="Close upper" onClose={topClose}>Upper</Sheet>
    </LazyMotion>;
    const view = render(sheets(true));
    view.rerender(sheets(false));
    expect(view.container.hasAttribute('inert')).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(screen.getByRole('dialog', { name: 'Upper' }).closest('[inert]')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(topClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });
});
