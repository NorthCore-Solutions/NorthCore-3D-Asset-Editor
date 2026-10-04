import { useCallback, useState } from 'react';
import { animationStore as store } from './store';
import type { PixelAsset, Rect } from './raster';
import { textField, number } from './builderForm';
import { Dialog } from './Dialog';
import type { DialogConfig } from './Dialog';
import { ColorDialog } from './ColorDialog';
import { help } from './help';
import type { HelpTopic } from './help';

/** Transient form/color dialogs and their status messages, owned by the builder instance. */
export function useBuilderDialogs() {
  const [modal, setModal] = useState<DialogConfig | null>(null);
  const [message, setMessage] = useState('Bereit');
  const [colorOpen, setColorOpen] = useState(false);
  const report = useCallback((task: Promise<unknown>) => {
    void task.catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Aktion fehlgeschlagen.')
    );
  }, []);
  const info = (topic: HelpTopic) => setModal({ title: topic, content: <p>{help[topic]}</p> });
  const infoButton = (topic: HelpTopic) => (
    <button
      className="ab-info"
      title={`Information: ${topic}`}
      aria-label={`Information: ${topic}`}
      onClick={() => info(topic)}
    >
      ⓘ
    </button>
  );
  const rename = (title: string, value: string, done: (name: string) => void) =>
    setModal({
      title,
      content: (
        <label>
          Name
          <input name="name" defaultValue={value} required autoFocus />
        </label>
      ),
      submit: (data) => {
        done(textField(data, 'name').trim());
      },
    });
  const saveTemplate = () => {
    setModal({
      title: 'Auswahl als Vorlage speichern',
      content: null,
      action: 'Speichern',
      submit: (data) => {
        const saved = store.saveAsset(textField(data, 'name'));
        setMessage(saved ? `${saved.name} gespeichert` : 'Keine bearbeitbaren Pixel ausgewählt.');
      },
    });
  };
  const insert = (asset: Pick<PixelAsset, 'name' | 'bounds'>, apply?: (to: Rect) => void) =>
    setModal({
      title: 'Vorlage einfügen',
      content: (
        <>
          <p>{asset.name}</p>
          {(['x', 'y', 'width', 'height'] as const).map((field) => (
            <label key={field}>
              {{ x: 'X', y: 'Y', width: 'Breite', height: 'Höhe' }[field]}
              <input
                name={field}
                type="number"
                step="1"
                min={field === 'width' || field === 'height' ? 1 : -127}
                max={128}
                defaultValue={asset.bounds[field]}
                required
              />
            </label>
          ))}
        </>
      ),
      action: 'Einfügen',
      submit: (data) => {
        const to = {
          x: number(data, 'x'),
          y: number(data, 'y'),
          width: number(data, 'width'),
          height: number(data, 'height'),
        };
        if (apply) apply(to); else store.insert(asset as PixelAsset, to);
      },
    });
  const overlays = <>
    {colorOpen && (
      <ColorDialog
        initial={store.color}
        onCancel={() => setColorOpen(false)}
        onApply={(color) => {
          store.color = color;
          store.emit();
          setColorOpen(false);
        }}
      />
    )}
    {modal && (
      <Dialog
        title={modal.title}
        action={modal.action}
        onCancel={() => setModal(null)}
        onSubmit={
          modal.submit
            ? (data) => {
                modal.submit?.(data);
                setModal(null);
              }
            : undefined
        }
      >
        {modal.title === 'Auswahl als Vorlage speichern' ? (
          <>
            <label>
              Vorlagen-Name
              <input name="name" required autoFocus defaultValue="Neue Vorlage" />
            </label>
          </>
        ) : (
          modal.content
        )}
      </Dialog>
    )}
  </>;
  return { modal, colorOpen, message, setModal, setMessage, setColorOpen, report,
    info, infoButton, rename, saveTemplate, insert, overlays };
}
export type BuilderDialogs = ReturnType<typeof useBuilderDialogs>;
