import { useLayoutEffect, useRef } from 'react';
import { EDITOR_MENU_OPENED } from './editorMenuModal';

export function EditorMenuDialog({ confirming, opener, onClose, onReturn, onConfirm }: {
  confirming: boolean;
  opener: HTMLElement | null;
  onClose: () => void;
  onReturn: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const outsidePress = useRef(false);
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    window.dispatchEvent(new Event(EDITOR_MENU_OPENED));
    return () => {
      dialog.close();
      queueMicrotask(() => {
        const target = opener?.isConnected && !opener.closest('[hidden]')
          ? opener : document.querySelector<HTMLElement>('.editor-launcher nav button');
        target?.focus({ preventScroll: true });
      });
    };
  }, [opener]);
  useLayoutEffect(() => {
    initialFocusRef.current?.focus({ preventScroll: true });
  }, [confirming]);
  const outside = (x: number, y: number) => {
    const bounds = dialogRef.current!.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  };
  return <dialog ref={dialogRef} className="editor-menu-dialog" data-editor-menu
    aria-labelledby="editor-menu-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onPointerDown={(event) => { outsidePress.current = event.target === event.currentTarget && outside(event.clientX, event.clientY); }}
    onClick={(event) => {
      if (outsidePress.current && event.target === event.currentTarget && outside(event.clientX, event.clientY)) {
        event.preventDefault(); event.stopPropagation(); onClose();
      }
      outsidePress.current = false;
    }}
    onPointerCancel={() => { outsidePress.current = false; }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      event.preventDefault(); buttons[next]?.focus();
    }}>
    <h2 id="editor-menu-title">{confirming ? 'Zur Editor-Auswahl?' : 'Menü'}</h2>
    {confirming ? <>
      <p>Es gibt ungespeicherte Änderungen. Sie bleiben in dieser Sitzung erhalten. Speichere im Editor, bevor du die App schließt.</p>
      <button ref={initialFocusRef} type="button" onClick={onClose}>Abbrechen</button>
      <button type="button" onClick={onConfirm}>Zur Auswahl</button>
    </> : <>
      <button className="editor-menu-return" type="button" onClick={onReturn}>Zur Editor-Auswahl</button>
      <button ref={initialFocusRef} className="editor-menu-resume" type="button" onClick={onClose}>Fortsetzen</button>
    </>}
  </dialog>;
}
