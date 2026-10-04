import { useState } from 'react';
import type { ReactNode } from 'react';
import { CollapseChevron } from '../components/layout/CollapseChevron';

export function BuilderHeader({ children, name, onOpenEditorMenu }: {
  children: ReactNode; name: string;
  onOpenEditorMenu?: () => void;
}) {
  return <header className="ab-menubar">
    <nav className="ab-main-menus" aria-label="Hauptmenü"
      onPointerOver={(event) => {
        if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return;
        const menu = event.target.closest<HTMLDetailsElement>('.ab-menu');
        if (menu && !menu.open && event.currentTarget.querySelector('.ab-menu[open]')) {
          menu.open = true;
          menu.dataset.hoverOpened = 'true';
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') event.currentTarget.querySelectorAll<HTMLDetailsElement>('.ab-menu').forEach((menu) => { menu.open = false; delete menu.dataset.hoverOpened; });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.querySelectorAll<HTMLDetailsElement>('.ab-menu').forEach((menu) => { menu.open = false; delete menu.dataset.hoverOpened; });
      }}
    >{children}</nav>
    <span className="ab-title" title={name}>{name}</span>
    <span className="ab-brand">NorthCore Animation Builder</span>
    {onOpenEditorMenu && <button className="editor-menu-trigger" type="button" aria-label="Menü öffnen" title="Menü" onClick={onOpenEditorMenu}><span aria-hidden="true">☰</span></button>}
  </header>;
}

export function BuilderMenu({ name, children }: { name: string; children: ReactNode }) {
  return <details className="ab-menu" name="animation-builder-main-menu">
    <summary onClick={(event) => {
      const menu = event.currentTarget.parentElement as HTMLDetailsElement;
      // A click after hovering to another menu keeps that newly opened menu open.
      if (menu.open && menu.dataset.hoverOpened && event.detail > 0) event.preventDefault();
      delete menu.dataset.hoverOpened;
    }}>{name}</summary><div role="menu">{children}</div>
  </details>;
}

export function LibraryTabs({ value, onChange, children }: {
  value: string; onChange: (value: string) => void; children: ReactNode;
}) {
  return <div className="ab-library">
    <div className="ab-library-tabs" role="tablist" aria-label="Bibliothek">
      {['Dateien', 'Vorlagen'].map((tab) => <button key={tab} role="tab" aria-selected={value === tab}
        aria-controls="ab-library-content" id={`ab-library-${tab}`} onClick={() => onChange(tab)}>{tab}</button>)}
    </div>
    <div className="ab-library-content" id="ab-library-content" role="tabpanel" aria-labelledby={`ab-library-${value}`}>{children}</div>
  </div>;
}

export function SelectionIcon({ polygon }: { polygon: boolean }) {
  return <svg className="ab-tool-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25">
    {polygon ? <path d="M8 1.75 14 5.25 14 10.75 8 14.25 2 10.75 2 5.25Z" /> : <rect x="2" y="2" width="12" height="12" />}
  </svg>;
}

export function FitIcon() {
  return <svg className="ab-tool-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25">
    <circle cx="6.5" cy="6.5" r="4.5" /><path d="m10 10 4 4" />
  </svg>;
}

export function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ab-tool-group" role="group" aria-label={label}>{children}</div>;
}

export function BuilderPanel({ side, title, open, onToggle, info, actions, children }: {
  side: 'left' | 'right' | 'timeline'; title: string; open: boolean;
  onToggle: () => void; info?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const direction = side === 'timeline' ? (open ? 'down' : 'up') : side === 'left' ? (open ? 'left' : 'right') : (open ? 'right' : 'left');
  return <section className={`ab-panel ab-${side}${open ? '' : ' is-collapsed'}`} aria-label={title}>
    <header className="ab-panel-header">
      <div className="ab-panel-heading" inert={!open}><strong>{title}</strong>{info}</div>
      <div className="ab-panel-actions" inert={!open}>{actions}</div>
      <button className="ab-collapse" type="button" title={title} aria-label={`${title} ${open ? 'ausblenden' : 'einblenden'}`} aria-expanded={open} onClick={onToggle}><CollapseChevron direction={direction} /></button>
    </header>
    <div className="ab-panel-content" inert={!open}>{children}</div>
  </section>;
}

export function InspectorSection({ title, info, children, defaultOpen = true }: {
  title: string; info: ReactNode; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className="ab-group">
    <header>
      <button className="ab-section-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>{title}
      </button>
      {info}
    </header>
    <div className="ab-section-content" hidden={!open}>{children}</div>
  </section>;
}
