import { create } from 'zustand';
import { createSceneObject } from '../geometry/factory';
import {
  findAvailableObjectGroupTranslation,
  findAvailableObjectPlacement
} from '../editor/placement/objectPlacement';
import { snapPosition } from '../editor/snapping/positionSnap';
import type { CameraView, MaterialData, PrimitiveType, ProjectFile, SceneObjectData, SceneSettings, Snapshot, SnapSettings, TransformMode, Vec3 } from '../types/editor';

const clone = <T,>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const defaultProject = () => ({ name: 'Unbenanntes Asset', createdAt: now(), updatedAt: now() });
const defaultScene = (): SceneSettings => ({ background: '#11161A', gridVisible: true, axesVisible: true, gridSize: 1 });

type EditorSnapshot = Snapshot & { selectedIds: string[] };

interface EditorState {
  objects: SceneObjectData[];
  selectedId: string | null;
  selectedIds: string[];
  project: ReturnType<typeof defaultProject>;
  scene: SceneSettings;
  tool: TransformMode;
  snap: SnapSettings;
  recentColors: string[];
  past: EditorSnapshot[];
  future: EditorSnapshot[];
  transactionStart: EditorSnapshot | null;
  sessionId: number;
  dirty: boolean;
  message: string;
  cameraView: CameraView;
  cameraRequestId: number;
  setMessage: (message: string) => void;
  setProjectName: (name: string) => void;
  setTool: (tool: TransformMode) => void;
  requestCameraView: (view: CameraView) => void;
  setScene: (patch: Partial<SceneSettings>) => void;
  setSnap: (patch: Partial<SnapSettings>) => void;
  select: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: string[], additive?: boolean) => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  addObject: (type: PrimitiveType) => void;
  deleteObject: (id?: string) => void;
  duplicateObject: (id?: string) => void;
  updateObject: (id: string, patch: Partial<SceneObjectData>, history?: boolean) => void;
  updateTransform: (id: string, key: 'position' | 'rotation' | 'scale', value: Vec3, history?: boolean) => void;
  updateMaterial: (id: string, patch: Partial<MaterialData>, history?: boolean) => void;
  beginTransaction: () => void;
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;
  newProject: (name?: string) => void;
  loadProject: (file: ProjectFile) => void;
  markSaved: (saved: Pick<EditorState, 'sessionId' | 'objects' | 'project' | 'scene'>) => boolean;
  snapshot: () => EditorSnapshot;
}

const snapshotFrom = (state: Pick<EditorState, 'objects' | 'project' | 'scene' | 'selectedId' | 'selectedIds'>): EditorSnapshot => ({
  objects: clone(state.objects),
  project: clone(state.project),
  scene: clone(state.scene),
  selectedId: state.selectedId,
  selectedIds: [...state.selectedIds]
});

const withHistory = (state: EditorState): Pick<EditorState, 'past' | 'future'> => ({
  past: [...state.past.slice(-99), snapshotFrom(state)],
  future: []
});

const expandSelection = (objects: SceneObjectData[], ids: string[]): string[] => {
  const expanded = new Set<string>();
  for (const id of ids) {
    const object = objects.find((item) => item.id === id);
    if (!object) continue;
    if (object.parentId) {
      objects.filter((item) => item.parentId === object.parentId).forEach((item) => expanded.add(item.id));
    } else {
      expanded.add(id);
    }
  }
  return [...expanded];
};

export const useEditorStore = create<EditorState>((set, get) => ({
  objects: [], selectedId: null, selectedIds: [], project: defaultProject(), scene: defaultScene(), tool: 'translate',
  snap: { enabled: false, surface: false, position: 0.25, rotation: 15, scale: 0.1 }, recentColors: [],
  past: [], future: [], transactionStart: null, sessionId: 0, dirty: false, message: 'Bereit', cameraView: 'perspective', cameraRequestId: 0,

  setMessage: (message) => set({ message }),
  setProjectName: (name) => set((state) => ({ ...withHistory(state), project: { ...state.project, name, updatedAt: now() }, dirty: true })),
  setTool: (tool) => set({ tool }),
  requestCameraView: (cameraView) => set((state) => ({ cameraView, cameraRequestId: state.cameraRequestId + 1 })),
  setScene: (patch) => set((state) => ({ ...withHistory(state), scene: { ...state.scene, ...patch }, dirty: true })),
  setSnap: (patch) => set((state) => ({ snap: { ...state.snap, ...patch } })),

  select: (id, additive = false) => set((state) => {
    if (!id) return { selectedId: null, selectedIds: [] };
    const targets = expandSelection(state.objects, [id]);
    if (!additive) return { selectedId: id, selectedIds: targets };

    const selected = new Set(state.selectedIds);
    const allSelected = targets.every((target) => selected.has(target));
    targets.forEach((target) => allSelected ? selected.delete(target) : selected.add(target));
    const selectedIds = [...selected];
    return { selectedId: selectedIds.includes(id) ? id : (selectedIds.at(-1) ?? null), selectedIds };
  }),

  selectMany: (ids, additive = false) => set((state) => {
    const targets = expandSelection(state.objects, ids);
    const selectedIds = additive ? [...new Set([...state.selectedIds, ...targets])] : targets;
    return { selectedIds, selectedId: selectedIds.at(-1) ?? null };
  }),

  groupSelection: () => set((state) => {
    if (state.selectedIds.length < 2) return state;
    const groupId = crypto.randomUUID();
    const selected = new Set(state.selectedIds);
    return {
      ...withHistory(state),
      objects: state.objects.map((object) => selected.has(object.id) ? { ...object, parentId: groupId } : object),
      dirty: true,
      message: `${state.selectedIds.length} Objekte gruppiert`
    };
  }),

  ungroupSelection: () => set((state) => {
    const groupIds = new Set(
      state.objects.filter((object) => state.selectedIds.includes(object.id) && object.parentId).map((object) => object.parentId as string)
    );
    if (groupIds.size === 0) return state;
    return {
      ...withHistory(state),
      objects: state.objects.map((object) => object.parentId && groupIds.has(object.parentId)
        ? { ...object, parentId: undefined }
        : object),
      dirty: true,
      message: 'Gruppierung aufgehoben'
    };
  }),

  addObject: (type) => set((state) => {
    const object = createSceneObject(type, state.objects.map((item) => item.id));
    object.position = findAvailableObjectPlacement(
      object,
      state.objects,
      state.snap.position,
      state.selectedId ?? undefined
    );

    return {
      ...withHistory(state),
      objects: [...state.objects, object],
      selectedId: object.id,
      selectedIds: [object.id],
      dirty: true,
      message: `${object.name} hinzugefügt`
    };
  }),

  deleteObject: (id) => set((state) => {
    const targets = id ? [id] : state.selectedIds;
    if (targets.length === 0) return state;
    const targetSet = new Set(targets);
    const objects = state.objects.filter((item) => !targetSet.has(item.id));
    const selectedIds = state.selectedIds.filter((selected) => !targetSet.has(selected));
    return {
      ...withHistory(state),
      objects,
      selectedIds,
      selectedId: selectedIds.at(-1) ?? null,
      dirty: true,
      message: `${targets.length} Objekt${targets.length === 1 ? '' : 'e'} gelöscht`
    };
  }),

  duplicateObject: (id) => set((state) => {
    const targets = id ? [id] : state.selectedIds;
    const sources = state.objects.filter((item) => targets.includes(item.id));
    if (sources.length === 0) return state;

    const preferredTargetId = id ?? state.selectedId ?? sources.at(-1)?.id;
    const translation = findAvailableObjectGroupTranslation(
      sources,
      state.objects,
      state.snap.position,
      preferredTargetId
    );
    const groupId = sources.length > 1 ? crypto.randomUUID() : undefined;
    const duplicates = sources.map((source): SceneObjectData => ({
      ...clone(source),
      id: crypto.randomUUID(),
      name: `${source.name} Kopie`,
      parentId: groupId,
      position: [
        source.position[0] + translation[0],
        source.position[1] + translation[1],
        source.position[2] + translation[2]
      ]
    }));

    return {
      ...withHistory(state),
      objects: [...state.objects, ...duplicates],
      selectedIds: duplicates.map((item) => item.id),
      selectedId: duplicates.at(-1)?.id ?? null,
      dirty: true,
      message: `${duplicates.length} Objekt${duplicates.length === 1 ? '' : 'e'} dupliziert`
    };
  }),

  updateObject: (id, patch, history = true) => set((state) => ({
    ...(history ? withHistory(state) : {}),
    objects: state.objects.map((object) => object.id === id ? { ...object, ...patch } : object),
    project: { ...state.project, updatedAt: now() }, dirty: true
  })),

  updateTransform: (id, key, value, history = true) => {
    const nextValue = key === 'position' ? snapPosition(value, get().snap) : value;
    get().updateObject(id, { [key]: nextValue }, history);
  },

  updateMaterial: (id, patch, history = true) => set((state) => {
    const current = state.objects.find((item) => item.id === id);
    if (!current) return state;
    const color = patch.color?.toUpperCase();
    const recentColors = color ? [color, ...state.recentColors.filter((item) => item !== color)].slice(0, 8) : state.recentColors;
    return {
      ...(history ? withHistory(state) : {}), recentColors,
      objects: state.objects.map((object) => object.id === id ? { ...object, material: { ...object.material, ...patch, ...(color ? { color } : {}) } } : object),
      project: { ...state.project, updatedAt: now() }, dirty: true
    };
  }),

  beginTransaction: () => set((state) => state.transactionStart ? state : { transactionStart: snapshotFrom(state) }),
  endTransaction: () => set((state) => {
    if (!state.transactionStart) return state;
    const changed = JSON.stringify(state.transactionStart.objects) !== JSON.stringify(state.objects);
    return { past: changed ? [...state.past.slice(-99), state.transactionStart] : state.past, future: changed ? [] : state.future, transactionStart: null, dirty: changed || state.dirty };
  }),

  undo: () => set((state) => {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return { ...clone(previous), past: state.past.slice(0, -1), future: [snapshotFrom(state), ...state.future].slice(0, 100), dirty: true, message: 'Rückgängig' };
  }),

  redo: () => set((state) => {
    const next = state.future[0];
    if (!next) return state;
    return { ...clone(next), past: [...state.past, snapshotFrom(state)].slice(-100), future: state.future.slice(1), dirty: true, message: 'Wiederholt' };
  }),

  newProject: (name = 'Unbenanntes Asset') => set((state) => ({
    sessionId: state.sessionId + 1,
    objects: [], selectedId: null, selectedIds: [], project: { ...defaultProject(), name }, scene: defaultScene(), past: [], future: [], transactionStart: null, dirty: false, message: 'Neues Projekt erstellt'
  })),

  loadProject: (file) => set((state) => ({
    sessionId: state.sessionId + 1,
    objects: clone(file.objects), selectedId: null, selectedIds: [], project: clone(file.project), scene: clone(file.scene), past: [], future: [], transactionStart: null, dirty: false, message: `${file.project.name} geladen`
  })),

  // Persistent edits replace these references; UI-only changes do not.
  markSaved: (saved) => {
    const state = get();
    if (state.sessionId !== saved.sessionId || state.objects !== saved.objects ||
      state.project !== saved.project || state.scene !== saved.scene) return false;
    set({ dirty: false, message: 'Projekt gespeichert' });
    return true;
  },
  snapshot: () => snapshotFrom(get())
}));
