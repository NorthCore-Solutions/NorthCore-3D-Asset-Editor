import { CollapseChevron } from '../layout/CollapseChevron';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SHAPE_DEFINITIONS } from '../../geometry/factory';
import { useEditorStore } from '../../store/editorStore';
import './shapes-inventory.css';

type InventoryCategory = 'Alle' | 'Formen' | 'Gebäude' | 'Möbel' | 'Natur' | 'Infrastruktur' | 'Dekoration' | 'Importiert';

interface ShapesPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

const INVENTORY_CATEGORIES: InventoryCategory[] = [
  'Alle',
  'Formen',
  'Gebäude',
  'Möbel',
  'Natur',
  'Infrastruktur',
  'Dekoration',
  'Importiert'
];

const SHAPE_ICONS: Partial<Record<(typeof SHAPE_DEFINITIONS)[number]['type'], string>> = {
  box: '■',
  cuboid: '▰',
  sphere: '●',
  hemisphere: '◒',
  cylinder: '⬤',
  cone: '▲',
  pyramid: '◆',
  plane: '▱',
  torus: '◎',
  wedge: '◢',
  prism: '⬡',
  wall: '▥',
  floor: '▬',
  flatRoof: '▔',
  gableRoof: '⌂',
  shedRoof: '◩',
  door: '▯',
  window: '⊞',
  column: '▮',
  chimney: '▯',
  stairs: '▟'
};

const inventoryCategoryFor = (category: (typeof SHAPE_DEFINITIONS)[number]['category']): InventoryCategory =>
  category === 'Grundformen' ? 'Formen' : 'Gebäude';

export function ShapesPanel({ collapsed, onToggle }: ShapesPanelProps) {
  const addObject = useEditorStore((state) => state.addObject);
  const categoryListRef = useRef<HTMLElement>(null);
  const [activeCategory, setActiveCategory] = useState<InventoryCategory>('Alle');
  const [search, setSearch] = useState('');
  const [canScrollCategoriesLeft, setCanScrollCategoriesLeft] = useState(false);
  const [canScrollCategoriesRight, setCanScrollCategoriesRight] = useState(false);

  const updateCategoryScrollState = useCallback(() => {
    const categoryList = categoryListRef.current;
    if (!categoryList) return;

    const maximumScrollLeft = Math.max(0, categoryList.scrollWidth - categoryList.clientWidth);
    setCanScrollCategoriesLeft(categoryList.scrollLeft > 1);
    setCanScrollCategoriesRight(categoryList.scrollLeft < maximumScrollLeft - 1);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateCategoryScrollState);
    window.addEventListener('resize', updateCategoryScrollState);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateCategoryScrollState);
    };
  }, [collapsed, updateCategoryScrollState]);

  const scrollCategories = (direction: -1 | 1) => {
    categoryListRef.current?.scrollBy({ left: direction * 120, behavior: 'smooth' });
  };

  const filteredShapes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('de-DE');

    return SHAPE_DEFINITIONS.filter((shape) => {
      const category = inventoryCategoryFor(shape.category);
      const matchesCategory = activeCategory === 'Alle' || activeCategory === category;
      const matchesSearch = !query || [shape.label, shape.type, category]
        .some((value) => value.toLocaleLowerCase('de-DE').includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, search]);

  const activeCategoryHasAssets = activeCategory === 'Alle' || activeCategory === 'Formen' || activeCategory === 'Gebäude';

  return (
    <aside className={`panel left-panel shapes-inventory${collapsed ? ' panel-collapsed' : ''}`}>
      <div className="panel-header inventory-header">
        {!collapsed && (
          <>
            <span className="panel-title">Inventar</span>
            <span className="inventory-count">{filteredShapes.length}</span>
          </>
        )}
        <button
          type="button"
          className="panel-collapse-button"
          onClick={onToggle}
          aria-label={collapsed ? 'Inventar einblenden' : 'Inventar ausblenden'}
          title={collapsed ? 'Inventar einblenden' : 'Inventar ausblenden'}
        >
          <CollapseChevron direction={collapsed ? 'right' : 'left'} />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="inventory-controls">
            <label className="inventory-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Assets suchen…"
                aria-label="Assets suchen"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Suche leeren">×</button>
              )}
            </label>

            <div className="inventory-category-strip">
              <button
                type="button"
                className="inventory-category-arrow inventory-category-arrow-left"
                onClick={() => scrollCategories(-1)}
                disabled={!canScrollCategoriesLeft}
                aria-label="Vorherige Kategorien anzeigen"
              >
                ‹
              </button>

              <nav
                ref={categoryListRef}
                className="inventory-categories"
                aria-label="Asset-Kategorien"
                onScroll={updateCategoryScrollState}
              >
                {INVENTORY_CATEGORIES.map((category) => (
                  <button
                    type="button"
                    key={category}
                    className={activeCategory === category ? 'active' : undefined}
                    onClick={() => setActiveCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </nav>

              <button
                type="button"
                className="inventory-category-arrow inventory-category-arrow-right"
                onClick={() => scrollCategories(1)}
                disabled={!canScrollCategoriesRight}
                aria-label="Weitere Kategorien anzeigen"
              >
                ›
              </button>
            </div>
          </div>

          <section className="inventory-results" aria-live="polite">
            {filteredShapes.length > 0 ? (
              <div className="inventory-grid">
                {filteredShapes.map((shape) => {
                  const category = inventoryCategoryFor(shape.category);
                  return (
                    <button
                      type="button"
                      className="inventory-item"
                      key={shape.type}
                      onClick={() => addObject(shape.type)}
                      title={`${shape.label} hinzufügen`}
                    >
                      <span className={`inventory-preview inventory-preview-${category === 'Formen' ? 'shape' : 'building'}`} aria-hidden="true">
                        {SHAPE_ICONS[shape.type] ?? '◆'}
                      </span>
                      <span className="inventory-item-label">{shape.label}</span>
                      <span className="inventory-item-category">{category}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="inventory-empty">
                <strong>{search ? 'Keine Treffer' : activeCategory}</strong>
                <span>
                  {search
                    ? `Für „${search}“ wurden keine Assets gefunden.`
                    : activeCategoryHasAssets
                      ? 'In dieser Kategorie sind derzeit keine passenden Assets vorhanden.'
                      : 'Diese Kategorie ist für spätere Asset-Pakete vorbereitet.'}
                </span>
              </div>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
