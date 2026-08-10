import {
  setDimensionOverlayVisible,
  useDimensionOverlayVisible
} from '../../editor/measurement/dimensionOverlaySession';
import {
  requestSurfaceCameraView,
  setSurfacePaintSettings
} from '../../editor/paint/surfacePaintSession';
import { useEditorStore } from '../../store/editorStore';
import type { CameraView, TransformMode } from '../../types/editor';

const tools: Array<{ mode: TransformMode; label: string; key: string }> = [
  { mode: 'translate', label: 'Verschieben', key: 'W/G' },
  { mode: 'rotate', label: 'Drehen', key: 'E/R' },
  { mode: 'scale', label: 'Skalieren', key: 'S' }
];
const views: Array<{ view: CameraView; label: string }> = [
  { view: 'perspective', label: 'Persp.' }, { view: 'front', label: 'Vorne' }, { view: 'back', label: 'Hinten' },
  { view: 'left', label: 'Links' }, { view: 'right', label: 'Rechts' }, { view: 'top', label: 'Oben' }, { view: 'bottom', label: 'Unten' }, { view: 'focus', label: 'Fokus' }
];

export function EditorToolbar() {
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const snap = useEditorStore((state) => state.snap);
  const setSnap = useEditorStore((state) => state.setSnap);
  const scene = useEditorStore((state) => state.scene);
  const setScene = useEditorStore((state) => state.setScene);
  const requestCameraView = useEditorStore((state) => state.requestCameraView);
  const dimensionsVisible = useDimensionOverlayVisible();

  const selectTool = (mode: TransformMode): void => {
    setSurfacePaintSettings({ enabled: false, cameraView: null });
    setTool(mode);
  };

  const selectCameraView = (view: CameraView): void => {
    if (selectedIds.length === 1) {
      requestSurfaceCameraView(view);
      return;
    }
    requestCameraView(view);
  };

  return (
    <div className="toolbar">
      <div className="group">{tools.map((item) => <button key={item.mode} className={tool === item.mode ? 'active' : ''} title={item.key} onClick={() => selectTool(item.mode)}>{item.label}</button>)}</div>
      <div className="group">{views.map((item) => <button key={item.view} onClick={() => selectCameraView(item.view)}>{item.label}</button>)}</div>
      <div className="group">
        <label><input type="checkbox" checked={scene.gridVisible} onChange={(event) => setScene({ gridVisible: event.target.checked })} /> Raster</label>
        <label><input type="checkbox" checked={scene.axesVisible} onChange={(event) => setScene({ axesVisible: event.target.checked })} /> Achsen</label>
      </div>
      <div className="group">
        <label><input type="checkbox" checked={snap.enabled} onChange={(event) => setSnap({ enabled: event.target.checked })} /> Snapping</label>
        <label className="disabled" title="Grundformen an den Fangflächen anderer Grundformen einrasten (vorerst deaktiviert)"><input type="checkbox" checked={snap.surface} disabled onChange={(event) => setSnap({ surface: event.target.checked })} /> Formen-Snap</label>
        <label title="Länge, Höhe und Tiefe aller sichtbaren Formen anzeigen"><input type="checkbox" checked={dimensionsVisible} onChange={(event) => setDimensionOverlayVisible(event.target.checked)} /> Maße</label>
        <label>Pos. <input type="number" min="0.01" step="0.05" value={snap.position} onChange={(event) => setSnap({ position: Number(event.target.value) })} /></label>
        <label>Grad <input type="number" min="1" step="1" value={snap.rotation} onChange={(event) => setSnap({ rotation: Number(event.target.value) })} /></label>
        <label>Skala <input type="number" min="0.01" step="0.05" value={snap.scale} onChange={(event) => setSnap({ scale: Number(event.target.value) })} /></label>
      </div>
    </div>
  );
}
