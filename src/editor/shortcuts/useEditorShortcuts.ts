import { useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';

const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
};

export function useEditorShortcuts(active = true): void {
  useEffect(() => {
    if (!active) return;
    const handle = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const state = useEditorStore.getState();
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'g' && event.shiftKey) { event.preventDefault(); state.ungroupSelection(); return; }
      if ((event.ctrlKey || event.metaKey) && key === 'g') { event.preventDefault(); state.groupSelection(); return; }
      if ((event.ctrlKey || event.metaKey) && key === 'd') { event.preventDefault(); state.duplicateObject(); return; }
      if ((event.ctrlKey || event.metaKey) && key === 'z' && event.shiftKey) { event.preventDefault(); state.redo(); return; }
      if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); state.undo(); return; }
      if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); state.redo(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        state.deleteObject();
        return;
      }
      if (key === 'w' || key === 'g') state.setTool('translate');
      else if (key === 'e' || key === 'r') state.setTool('rotate');
      else if (key === 's') state.setTool('scale');
      else if (key === 'f') state.requestCameraView('focus');
      else if (event.key === 'Escape') state.select(null);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [active]);
}
