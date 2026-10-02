import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function Dialog({
  title,
  children,
  onCancel,
  onSubmit,
  action = 'Übernehmen',
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onSubmit?: (data: FormData) => void;
  action?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="ab-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !(event.target instanceof HTMLTextAreaElement) &&
            !(event.target instanceof HTMLElement && event.target.isContentEditable)
          ) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (event.currentTarget.reportValidity()) {
            if (onSubmit) onSubmit(new FormData(event.currentTarget));
            else onCancel();
          }
        }}
      >
        <h2>{title}</h2>
        {children}
        <footer>
          <button type="button" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="primary">
            {onSubmit ? action : 'OK'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
