/**
 * Renders the app's toast store (src/lib/toast.ts) with the kit's ToastViewport.
 * Mount once in the root shell: `<ToastHost />`. Features keep calling
 * `toast.success(t('…'))` from src/lib/toast.ts.
 *
 * Kept out of the barrel on purpose: it is the one place where the kit depends on src/lib.
 */
import { toast, useToasts } from '../lib/toast';
import { MotionScope } from '../motion/MotionScope';
import { ToastViewport, type ToastViewItem } from './Toast';

const noop = () => {};

export function ToastHost({ maxVisible = 1 }: { maxVisible?: number }) {
  const items = useToasts();
  const view: ToastViewItem[] = items.slice(0, maxVisible).map((t) => ({
    id: String(t.id),
    message: t.text,
    kind: t.kind,
    duration: t.duration,
    action: t.actionLabel ? { label: t.actionLabel, onClick: t.onAction ?? noop } : undefined,
  }));
  // its own motion scope: the shell around it has no LazyMotion (docs/decisions/2026-10-20-motion-scope.md)
  return (
    <MotionScope>
      <ToastViewport items={view} onDismiss={(id) => toast.dismiss(Number(id))} />
    </MotionScope>
  );
}
