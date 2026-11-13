import '../../ui/test-shims-dom';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DirectorContext, MomentFamily } from './director';

const choose = vi.hoisted(() => vi.fn((_family: MomentFamily, context: DirectorContext) => context.motion === 'full' ? { preset: 'corner-right', coat: 'blue', edge: 'right' } : null));
vi.mock('./director', () => ({ pickMoment: choose }));
vi.mock('./WelcomeBunnies', () => ({ default: (props: { choreography: string; bunnies?: string[]; calmEyes: string }) => <div data-testid="host" data-preset={props.choreography} data-coat={props.bunnies?.[0]} data-eyes={props.calmEyes} /> }));
import { BunnyMoment } from './BunnyMoment';

beforeEach(() => { choose.mockClear(); document.documentElement.dataset.motion = 'full'; document.documentElement.dataset.bunnies = 'on'; });
afterEach(() => { document.documentElement.removeAttribute('data-motion'); document.documentElement.removeAttribute('data-bunnies'); });

it('reuses one logical host choice across StrictMode and applies its coat and edge preset', async () => {
  const view = render(<StrictMode><BunnyMoment kind="peek" family="screen-host:start" calm="still" /></StrictMode>);
  const host = await screen.findByTestId('host');
  expect(host.dataset.preset).toBe('corner-right');
  expect(host.dataset.coat).toBe('blue');
  expect(choose.mock.calls[0]?.[1].placement).toBe('illustration');
  expect(new Set(choose.mock.calls.map(([, context]) => context.requestKey)).size).toBe(1);
  const count = choose.mock.calls.length;
  view.rerender(<StrictMode><BunnyMoment kind="peek" family="screen-host:start" calm="still" /></StrictMode>);
  expect(choose).toHaveBeenCalledTimes(count);
});

it('reduced keeps the ordinary calm illustration rather than its rotating full-motion preset', async () => {
  document.documentElement.dataset.motion = 'reduce';
  render(<BunnyMoment kind="peek" family="screen-host:start" calm="still" />);
  const host = await screen.findByTestId('host');
  expect(host.dataset.preset).toBe('peek-once');
  expect(host.dataset.eyes).toBe('happy');
});

it('off removes the host and does not consume a director choice', () => {
  document.documentElement.dataset.motion = 'off';
  const view = render(<BunnyMoment kind="peek" family="screen-host:start" calm="still" />);
  expect(view.container.innerHTML).toBe('');
  expect(choose).not.toHaveBeenCalled();
});
