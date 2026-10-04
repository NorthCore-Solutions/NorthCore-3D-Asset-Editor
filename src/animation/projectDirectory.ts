import { RASTER_DOCUMENT_EXTENSION } from './files';

export interface ProjectFileHandle {
  kind: 'file'; name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface ProjectDirectoryHandle {
  kind: 'directory'; name: string;
  values(): AsyncIterable<ProjectDirectoryHandle | ProjectFileHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<ProjectFileHandle>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}
type DirectoryWindow = Window & { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<ProjectDirectoryHandle> };
export const supportsProjectDirectory = () => typeof window !== 'undefined' && typeof (window as DirectoryWindow).showDirectoryPicker === 'function';
export function pickProjectDirectory() {
  const picker = (window as DirectoryWindow).showDirectoryPicker;
  if (!picker) throw Error('Ordnerbindung wird hier nicht unterstützt. Datei-Import und Export bleiben verfügbar.');
  return picker.call(window, { mode: 'readwrite' });
}

/** Persist only the structured-cloneable root handle, never a directory tree. */
export async function rememberedProjectDirectory(handle?: ProjectDirectoryHandle | null): Promise<ProjectDirectoryHandle | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('northcore-raster128-directory', 1); let abandoned = false;
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => { if (abandoned) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error ?? Error('Ordnerspeicher konnte nicht geöffnet werden.'));
    request.onblocked = () => { abandoned = true; reject(Error('Ordnerspeicher ist durch einen anderen Tab blockiert.')); };
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', handle === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('handles');
      const request = handle === undefined ? store.get('root') : handle === null ? store.delete('root') : store.put(handle, 'root');
      tx.oncomplete = () => resolve(handle === undefined ? request.result as ProjectDirectoryHandle | undefined : handle ?? undefined);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('Ordner-Handle konnte nicht gespeichert werden.'));
    });
  } finally { db.close(); }
}
export async function projectEntries(directory: ProjectDirectoryHandle) {
  const entries: (ProjectDirectoryHandle | ProjectFileHandle)[] = [];
  for await (const entry of directory.values()) {
    if (entry.kind === 'directory' || entry.name.toLowerCase().endsWith(RASTER_DOCUMENT_EXTENSION)) entries.push(entry);
  }
  return entries.sort((a, b) => a.kind !== b.kind ? a.kind === 'directory' ? -1 : 1 : a.name.localeCompare(b.name, 'de', { numeric: true }));
}
export function projectFileName(name: string) {
  const cleaned = Array.from(name, (char) => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char).join('').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') throw Error('Bitte einen Dateinamen angeben.');
  return cleaned.toLowerCase().endsWith(RASTER_DOCUMENT_EXTENSION) ? cleaned : `${cleaned}${RASTER_DOCUMENT_EXTENSION}`;
}
export async function writeProjectFile(handle: ProjectFileHandle, json: string) {
  const writer = await handle.createWritable();
  try { await writer.write(json); await writer.close(); }
  catch (error) { try { await writer.abort(); } catch { /* Preserve the original write error. */ } throw error; }
}
/** Right/down cascade, mirrored to the left when necessary and clamped for touch. */
export function projectFlyoutPosition(anchor: { left: number; right: number; top: number }, width: number, height: number, viewport: { width: number; height: number }) {
  const x = anchor.right + 6;
  return {
    left: Math.max(8, Math.min(x + width <= viewport.width - 8 ? x : anchor.left - width - 6, viewport.width - width - 8)),
    top: Math.max(8, Math.min(anchor.top + 8, viewport.height - height - 8)),
  };
}
