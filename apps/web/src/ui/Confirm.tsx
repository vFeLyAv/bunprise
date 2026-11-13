import type { ReactNode } from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';

export interface ConfirmProps {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Red confirm button (delete, leave). */
  destructive?: boolean;
  /** Spinner on the confirm button while the server works. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation as a bottom sheet — never window.confirm() (§3 destructive). */
export function Confirm({ open, title, message, confirmLabel, cancelLabel, destructive, loading, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      closeLabel={cancelLabel}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            size="lg"
            fullWidth
            loading={loading}
            hapticKind={destructive ? 'warning' : 'tap'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button variant="secondary" size="lg" fullWidth disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      }
    >
      {message ? <p className="pb-2 t-body text-text-2">{message}</p> : null}
    </Sheet>
  );
}
