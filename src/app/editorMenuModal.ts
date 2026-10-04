export const EDITOR_MENU_OPENED = 'editor-menu-opened';
export const isEditorMenuModalOpen = (): boolean =>
  typeof document !== 'undefined' && document.querySelector('dialog[data-editor-menu][open]') !== null;
