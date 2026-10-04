import { useEffect } from 'react';
import { isEditorMenuModalOpen } from '../app/editorMenuModal';
import { animationStore as store } from './store';
import type { DialogConfig } from './Dialog';

export function useBuilderShortcuts(modal: DialogConfig | null, colorOpen: boolean) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        isEditorMenuModalOpen() ||
        modal ||
        colorOpen ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input,textarea,select,[contenteditable]'))
      )
        return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
        }
        if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          store.redo();
        }
      }
      if (event.key === 'Escape') {
        document
          .querySelectorAll('.ab-menu[open],.ab-layer-menu[open]')
          .forEach((element) => element.removeAttribute('open'));
        store.cancelPicker();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modal, colorOpen]);
}
