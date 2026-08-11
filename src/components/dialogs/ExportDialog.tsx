import { useMemo, useState } from 'react';
import { exportGlb, inspectExport, type ExportGeometryMode } from '../../export/exportScene';
import { isNativeAndroid, saveBlobAs } from '../../platform/nativeFileDialog';
import { safeFilename } from '../../persistence/projectFile';
import { useEditorStore } from '../../store/editorStore';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const objects = useEditorStore((state) => state.objects);
  const selectedId = useEditorStore((state) => state.selectedId);
  const projectName = useEditorStore((state) => state.project.name);
  const setMessage = useEditorStore((state) => state.setMessage);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [geometryMode, setGeometryMode] = useState<ExportGeometryMode>('separate');
  const [filename, setFilename] = useState(projectName);
  const [busy, setBusy] = useState(false);
  const report = useMemo(
    () => inspectExport(objects, selectedId, selectionOnly, geometryMode),
    [geometryMode, objects, selectedId, selectionOnly]
  );

  const runExport = async () => {
    if (report.objects.length === 0) { setMessage('Export abgebrochen: keine sichtbaren Objekte'); return; }
    setBusy(true);
    try {
      const blob = await exportGlb(report.objects, filename, geometryMode);
      let savedName = `${safeFilename(filename)}.glb`;

      if (isNativeAndroid()) {
        const saved = await saveBlobAs(blob, savedName, 'model/gltf-binary');
        if (!saved) return;
        savedName = saved.name;
      }

      const modeLabel = geometryMode === 'union' && report.unionEligible >= 2 ? 'Union' : 'getrennte Meshes';
      setMessage(`GLB gespeichert (${modeLabel}): ${savedName} · ${(blob.size / 1024).toFixed(1)} KB`);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? `GLB-Export fehlgeschlagen: ${error.message}` : 'GLB-Export fehlgeschlagen');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="GLB exportieren">
        <h2>GLB exportieren</h2>
        <div className="modal-content">
          <div className="field-row"><label>Dateiname</label><input value={filename} onChange={(event) => setFilename(event.target.value)} /></div>
          <div className="field-row"><label>Umfang</label><select value={selectionOnly ? 'selection' : 'scene'} onChange={(event) => setSelectionOnly(event.target.value === 'selection')}><option value="scene">Gesamte sichtbare Szene</option><option value="selection">Nur Auswahl</option></select></div>
          <div className="field-row">
            <label>Aktion</label>
            <select value={geometryMode} onChange={(event) => setGeometryMode(event.target.value as ExportGeometryMode)}>
              <option value="separate">Getrennte Meshes exportieren</option>
              <option value="union">Volumenkörper als Union exportieren</option>
            </select>
          </div>
          <div className="export-report"><strong>{report.objects.length}</strong> Objekte · <strong>{report.triangles.toLocaleString('de-DE')}</strong> Dreiecke</div>
          {geometryMode === 'union' && (
            <div className="export-report">
              <strong>{report.unionEligible}</strong> geschlossene Volumenkörper für Union · <strong>{report.unionSeparate}</strong> separat
            </div>
          )}
          {report.warnings.length > 0 && <ul className="warning-list">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <p>
            {geometryMode === 'union'
              ? 'Geschlossene Volumenkörper – auch bemalte – werden nur für die exportierte GLB boolesch vereinigt. Die Editor-Szene bleibt unverändert.'
              : 'Transformationen und Materialien werden eingebettet. Raster, Achsen und Editor-Helfer werden nicht exportiert.'}
          </p>
        </div>
        <div className="modal-actions"><button onClick={onClose}>Abbrechen</button><button disabled={busy || report.objects.length === 0} onClick={() => void runExport()}>{busy ? 'Export läuft…' : 'GLB speichern'}</button></div>
      </div>
    </div>
  );
}
