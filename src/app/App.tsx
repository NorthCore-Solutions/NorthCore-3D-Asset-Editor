import { useEffect, useState } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { StatusBar } from '../components/layout/StatusBar';
import { ShapesPanel } from '../components/panels/ShapesPanel';
import { PropertiesPanel } from '../components/panels/PropertiesPanel';
import { HierarchyPanel } from '../components/panels/HierarchyPanel';
import { EditorToolbar } from '../components/toolbar/EditorToolbar';
import { RestoreDialog } from '../components/dialogs/RestoreDialog';
import { EditorViewport } from '../editor/viewport/EditorViewport';
import { ViewportHelp } from '../editor/viewport/ViewportHelp';
import '../editor/viewport/viewport-help.css';
import '../styles/panel-collapse.css';
import '../styles/tablet.css';
import { useEditorShortcuts } from '../editor/shortcuts/useEditorShortcuts';
import { AUTOSAVE_KEY, buildProjectFile, deserializeProject, serializeProject } from '../persistence/projectFile';
import { useEditorStore } from '../store/editorStore';

const TABLET_MEDIA_QUERY = '(max-width: 1180px), (pointer: coarse) and (max-width: 1400px)';

const isCompactWorkspace = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia(TABLET_MEDIA_QUERY).matches;

export function App({ active = true }: { active?: boolean }) {
  useEditorShortcuts(active);
  const objects = useEditorStore((state) => state.objects);
  const project = useEditorStore((state) => state.project);
  const scene = useEditorStore((state) => state.scene);
  const loadProject = useEditorStore((state) => state.loadProject);
  const setMessage = useEditorStore((state) => state.setMessage);
  const [initialAutosave] = useState(() => localStorage.getItem(AUTOSAVE_KEY));
  const [restoreOpen, setRestoreOpen] = useState(Boolean(initialAutosave));
  const [compactWorkspace, setCompactWorkspace] = useState(isCompactWorkspace);
  const [inventoryCollapsed, setInventoryCollapsed] = useState(isCompactWorkspace);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(isCompactWorkspace);
  const [hierarchyCollapsed, setHierarchyCollapsed] = useState(isCompactWorkspace);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const file = buildProjectFile(project, scene, objects);
      localStorage.setItem(AUTOSAVE_KEY, serializeProject({ project: file.project, scene: file.scene, objects: file.objects }));
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [objects, project, scene]);

  useEffect(() => {
    const media = window.matchMedia(TABLET_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent): void => {
      setCompactWorkspace(event.matches);
      if (!event.matches) return;
      setInventoryCollapsed(true);
      setPropertiesCollapsed(true);
      setHierarchyCollapsed(true);
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  const restore = () => {
    if (!initialAutosave) { setRestoreOpen(false); return; }
    try { loadProject(deserializeProject(initialAutosave)); }
    catch (error) { setMessage(error instanceof Error ? `Autosave ungültig: ${error.message}` : 'Autosave ungültig'); localStorage.removeItem(AUTOSAVE_KEY); }
    setRestoreOpen(false);
  };

  const discard = () => { localStorage.removeItem(AUTOSAVE_KEY); setRestoreOpen(false); };
  const toggleInventory = (): void => {
    if (compactWorkspace && inventoryCollapsed) setPropertiesCollapsed(true);
    setInventoryCollapsed(!inventoryCollapsed);
  };
  const toggleProperties = (): void => {
    if (compactWorkspace && propertiesCollapsed) setInventoryCollapsed(true);
    setPropertiesCollapsed(!propertiesCollapsed);
  };
  const workspaceClassName = [
    'workspace',
    compactWorkspace ? 'compact-workspace' : '',
    inventoryCollapsed ? 'inventory-collapsed' : '',
    propertiesCollapsed ? 'properties-collapsed' : '',
    hierarchyCollapsed ? 'hierarchy-collapsed' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className="app-shell">
      <TopBar />
      <EditorToolbar />
      <main className={workspaceClassName}>
        <ShapesPanel collapsed={inventoryCollapsed} onToggle={toggleInventory} />
        {active && <EditorViewport />}
        <ViewportHelp />
        <PropertiesPanel collapsed={propertiesCollapsed} onToggle={toggleProperties} />
        <HierarchyPanel collapsed={hierarchyCollapsed} onToggle={() => setHierarchyCollapsed((current) => !current)} />
      </main>
      <StatusBar />
      {restoreOpen && <RestoreDialog onRestore={restore} onDiscard={discard} />}
    </div>
  );
}
