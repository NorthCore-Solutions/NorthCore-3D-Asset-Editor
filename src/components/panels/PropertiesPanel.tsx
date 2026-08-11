import { useEffect, useMemo, useRef, useState } from 'react';
import { MATERIAL_PRESETS } from '../../materials/presets';
import { createGeometry } from '../../geometry/factory';
import {
  cornerRoundnessValue,
  edgeRoundnessValue,
  supportsGeometryRounding
} from '../../geometry/rounding';
import { FULL_SURFACE_UV_ATLAS, getSurfaceUvAtlas } from '../../geometry/uvAtlas';
import { getSurfaceRasterMetrics } from '../../editor/paint/surfacePaintGrid';
import { setSurfacePaintSettings, subscribeSurfacePaint } from '../../editor/paint/surfacePaintSession';
import { recolorPaintTexture } from '../../editor/paint/recolorPaintTexture';
import { withPaintBaseColor } from '../../editor/paint/paintDocument';
import { useEditorStore } from '../../store/editorStore';
import type { MaterialData, PaintTextureData, Vec3 } from '../../types/editor';
import { StandardColorPicker } from './StandardColorPicker';
import { TexturePaintEditor } from './TexturePaintEditor';

interface PropertiesPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

type ColorTarget = 'base' | 'paint';

const round = (value: number) => Number(value.toFixed(3));

function VectorEditor({ label, value, unit, onChange }: { label: string; value: Vec3; unit?: 'deg'; onChange: (value: Vec3) => void }) {
  const shown = value.map((item) => round(unit === 'deg' ? item * 180 / Math.PI : item)) as Vec3;
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="vector-grid">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis}>{axis}<input type="number" step={0.001} value={shown[index]} onChange={(event) => {
            const next = [...shown] as Vec3;
            next[index] = round(Number(event.target.value));
            onChange(unit === 'deg'
              ? next.map((item) => item * Math.PI / 180) as Vec3
              : next.map(round) as Vec3);
          }} /></label>
        ))}
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  decimals = 2,
  className,
  title,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  className?: string;
  title?: string;
  onChange: (value: number, history?: boolean) => void;
}) {
  const begin = useEditorStore((state) => state.beginTransaction);
  const end = useEditorStore((state) => state.endTransaction);
  return (
    <div className={`range-row${className ? ` ${className}` : ''}`} title={title}>
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onChange={(event) => onChange(Number(event.target.value), false)}
      />
      <span>{value.toFixed(decimals)}</span>
    </div>
  );
}

function PropertiesHeader({ collapsed, onToggle }: PropertiesPanelProps) {
  return (
    <div className="panel-header">
      {!collapsed && <span className="panel-title">Eigenschaften</span>}
      <button
        type="button"
        className="panel-collapse-button"
        onClick={onToggle}
        aria-label={collapsed ? 'Eigenschaften einblenden' : 'Eigenschaften ausblenden'}
        title={collapsed ? 'Eigenschaften einblenden' : 'Eigenschaften ausblenden'}
      >
        {collapsed ? '‹' : '›'}
      </button>
    </div>
  );
}

export function PropertiesPanel({ collapsed, onToggle }: PropertiesPanelProps) {
  const selectedId = useEditorStore((state) => state.selectedId);
  const object = useEditorStore((state) => state.objects.find((item) => item.id === selectedId));
  const updateObject = useEditorStore((state) => state.updateObject);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const updateMaterial = useEditorStore((state) => state.updateMaterial);
  const duplicateObject = useEditorStore((state) => state.duplicateObject);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const [colorTarget, setColorTarget] = useState<ColorTarget>('base');
  const [paintColor, setPaintColor] = useState('#AEB8BE');
  const recolorRequestRef = useRef(0);

  useEffect(() => subscribeSurfacePaint((settings) => {
    setPaintColor(settings.color);
  }), []);

  const paintSurface = useMemo(() => {
    if (!object) {
      return {
        atlas: FULL_SURFACE_UV_ATLAS,
        metrics: [{
          label: 'Oberfläche',
          width: 32,
          height: 32,
          coverageU: 1,
          coverageV: 1,
          worldWidth: 1,
          worldHeight: 1
        }]
      };
    }

    const geometry = createGeometry({ type: object.type, geometry: object.geometry });
    const atlas = getSurfaceUvAtlas(geometry);
    const metrics = getSurfaceRasterMetrics(geometry, object.scale, atlas);
    geometry.dispose();
    return { atlas, metrics };
  }, [
    object?.geometry,
    object?.type,
    object?.scale[0],
    object?.scale[1],
    object?.scale[2]
  ]);

  if (collapsed) {
    return <aside className="panel right-panel panel-collapsed"><PropertiesHeader collapsed onToggle={onToggle} /></aside>;
  }

  if (!object) {
    return (
      <aside className="panel right-panel">
        <PropertiesHeader collapsed={false} onToggle={onToggle} />
        <div className="properties-scroll-content">
          <div className="empty-state">Kein Objekt ausgewählt</div>
        </div>
        <div className="panel-end-space" aria-hidden="true" />
      </aside>
    );
  }

  const setMaterial = (patch: Partial<MaterialData>, history = true) => updateMaterial(object.id, patch, history);
  const setGeometry = (patch: Record<string, number>, history = true) => updateObject(
    object.id,
    { geometry: { ...object.geometry, ...patch } },
    history
  );
  const shownColor = colorTarget === 'base' ? object.material.color : paintColor;

  const changeBaseColor = (normalized: string): void => {
    const previousColor = object.material.color;
    const paintTexture = object.material.paintTexture;
    const sourceDataUrl = paintTexture?.dataUrl;
    const requestId = ++recolorRequestRef.current;

    if (!paintTexture || previousColor.toUpperCase() === normalized) {
      setMaterial({ color: normalized });
      return;
    }

    const { atlas, metrics } = paintSurface;
    void recolorPaintTexture(paintTexture, atlas, metrics, normalized)
      .then((updatedTexture) => {
        const currentObject = useEditorStore.getState().objects.find((item) => item.id === object.id);
        const currentDataUrl = currentObject?.material.paintTexture?.dataUrl;
        if (recolorRequestRef.current !== requestId || currentDataUrl !== sourceDataUrl) return;
        updateMaterial(object.id, {
          color: normalized,
          paintTexture: updatedTexture
        });
      })
      .catch(() => undefined);
  };

  const changeSelectedColor = (color: string): void => {
    const normalized = color.toUpperCase();
    if (colorTarget === 'base') changeBaseColor(normalized);
    else setSurfacePaintSettings({ color: normalized });
  };

  const commitPaintTexture = (paintTexture: PaintTextureData | undefined): void => {
    recolorRequestRef.current += 1;
    setMaterial({ paintTexture: withPaintBaseColor(paintTexture, object.material.color) });
  };

  return (
    <aside className="panel right-panel">
      <PropertiesHeader collapsed={false} onToggle={onToggle} />
      <div className="properties-scroll-content">
        <section className="panel-section">
          <h3>Objekt</h3>
          <div className="field-row"><label>Name</label><input value={object.name} onChange={(event) => updateObject(object.id, { name: event.target.value })} /></div>
          <div className="field-row"><label>Typ</label><input value={object.type} readOnly /></div>
          <div className="field-row"><label>Sichtbar</label><input type="checkbox" checked={object.visible} onChange={(event) => updateObject(object.id, { visible: event.target.checked })} /></div>
          <div className="field-row"><label>Gesperrt</label><input type="checkbox" checked={object.locked} onChange={(event) => updateObject(object.id, { locked: event.target.checked })} /></div>
          <div className="inline-actions"><button onClick={() => duplicateObject(object.id)}>Duplizieren</button><button className="danger" onClick={() => deleteObject(object.id)}>Löschen</button></div>
        </section>

        <section className="panel-section">
          <h3>Transformation</h3>
          <VectorEditor label="Position" value={object.position} onChange={(value) => updateTransform(object.id, 'position', value)} />
          <VectorEditor label="Rotation" value={object.rotation} unit="deg" onChange={(value) => updateTransform(object.id, 'rotation', value)} />
          <VectorEditor label="Skalierung" value={object.scale} onChange={(value) => updateTransform(object.id, 'scale', value)} />
          {supportsGeometryRounding(object.type) && (
            <div className="rounding-controls">
              <RangeField
                className="rounding-range-row"
                label="Ecken abrunden"
                value={cornerRoundnessValue(object.geometry)}
                min={0}
                max={100}
                step={1}
                decimals={0}
                title="Bestimmt die Größe des Abrundungsradius."
                onChange={(value, history) => setGeometry({ cornerRoundness: value }, history)}
              />
              <RangeField
                className="rounding-range-row"
                label="Eckkanten abrunden"
                value={edgeRoundnessValue(object.geometry)}
                min={0}
                max={100}
                step={1}
                decimals={0}
                title="Bestimmt, wie weich die abgerundeten Kanten aufgebaut werden."
                onChange={(value, history) => setGeometry({ edgeRoundness: value }, history)}
              />
            </div>
          )}
        </section>

        <section className="panel-section">
          <h3>Material & Farben</h3>
          <div className="field-row"><label>Vorlage</label><select defaultValue="" onChange={(event) => { const preset = MATERIAL_PRESETS[event.target.value]; if (preset) setMaterial(preset); }}><option value="">– auswählen –</option>{Object.keys(MATERIAL_PRESETS).map((name) => <option key={name}>{name}</option>)}</select></div>

          <div className="merged-color-block">
            <div className="color-target-toggle">
              <button type="button" className={colorTarget === 'base' ? 'color-target-button active' : 'color-target-button'} onClick={() => setColorTarget('base')}>Grundfarbe</button>
              <button type="button" className={colorTarget === 'paint' ? 'color-target-button active' : 'color-target-button'} onClick={() => setColorTarget('paint')}>Malfarbe</button>
            </div>
            <StandardColorPicker value={shownColor} onChange={changeSelectedColor} />
          </div>

          <RangeField label="Rauheit" value={object.material.roughness} min={0} max={1} step={0.01} onChange={(value, history) => setMaterial({ roughness: value }, history)} />
          <RangeField label="Metallisch" value={object.material.metalness} min={0} max={1} step={0.01} onChange={(value, history) => setMaterial({ metalness: value }, history)} />
          <RangeField label="Transparenz" value={object.material.opacity} min={0} max={1} step={0.01} onChange={(value, history) => setMaterial({ opacity: value }, history)} />
          <div className="field-row"><label>Flat Shading</label><input type="checkbox" checked={object.material.flatShading} onChange={(event) => setMaterial({ flatShading: event.target.checked })} /></div>
        </section>

        <section className="panel-section">
          <h3>Bemalung</h3>
          <TexturePaintEditor
            objectId={object.id}
            baseColor={object.material.color}
            texture={object.material.paintTexture}
            atlas={paintSurface.atlas}
            metrics={paintSurface.metrics}
            onCommit={commitPaintTexture}
            onPaintModeChange={(enabled) => {
              if (enabled) setColorTarget('paint');
            }}
          />
        </section>
      </div>
      <div className="panel-end-space" aria-hidden="true" />
    </aside>
  );
}
