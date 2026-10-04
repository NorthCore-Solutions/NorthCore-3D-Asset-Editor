import { beforeEach, expect, it } from 'vitest';
import { useEditorStore } from '../src/store/editorStore';
import { buildProjectFile } from '../src/persistence/projectFile';

beforeEach(() => useEditorStore.getState().newProject());

it('persistent object and scene changes cannot be marked saved by an older snapshot', () => {
  const initial = useEditorStore.getState();
  initial.addObject('box');
  expect(initial.markSaved(initial)).toBe(false);
  const withObject = useEditorStore.getState();
  withObject.updateTransform(withObject.objects[0]!.id, 'position', [1, 2, 3], false);
  expect(withObject.markSaved(withObject)).toBe(false);
  const transformed = useEditorStore.getState();
  transformed.setScene({ gridVisible: false });
  expect(transformed.markSaved(transformed)).toBe(false);
  expect(useEditorStore.getState().dirty).toBe(true);
});

it('a session change rejects the old snapshot even when loading identical content', () => {
  const saved = useEditorStore.getState();
  saved.loadProject(buildProjectFile(saved.project, saved.scene, saved.objects));
  const loaded = useEditorStore.getState();
  expect(loaded.sessionId).not.toBe(saved.sessionId);
  expect(loaded.markSaved(saved)).toBe(false);
  loaded.newProject();
  expect(useEditorStore.getState().markSaved(loaded)).toBe(false);
});
