import { NativeFileDialog, blobToBase64 } from '../platform/nativeFileDialog';
import type { NativeDirectoryEntry } from '../platform/nativeFileDialog';
import type { ProjectDirectoryHandle, ProjectFileHandle } from './projectDirectory';

/** SAF identifiers stay opaque. Only the native plugin constructs content:// document URIs. */
async function nativeCall<T>(task: Promise<T>): Promise<T> {
  try { return await task; }
  catch (error) {
    const failure = error as { code?: string; message?: string };
    if (failure.code === 'NotAllowedError' || failure.code === 'NotFoundError') {
      throw new DOMException(failure.message ?? 'Ordnerzugriff fehlgeschlagen.', failure.code);
    }
    throw error;
  }
}

function fileHandle(entry: NativeDirectoryEntry): ProjectFileHandle {
  return {
    kind: 'file', name: entry.name,
    async getFile() {
      const { base64 } = await nativeCall(NativeFileDialog.readDocument(entry));
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      return new File([bytes], entry.name, { type: 'application/json' });
    },
    createWritable() {
      // Buffer until close, matching the Web writer's commit boundary. Abort never writes.
      let content = '', closed = false;
      return Promise.resolve({
        write(data: string) {
          if (closed) return Promise.reject(new DOMException('Datei ist geschlossen.', 'InvalidStateError'));
          content = data;
          return Promise.resolve();
        },
        async close() {
          if (closed) throw new DOMException('Datei ist geschlossen.', 'InvalidStateError');
          await nativeCall(NativeFileDialog.writeDocument({ ...entry, base64: await blobToBase64(new Blob([content])) }));
          closed = true;
        },
        abort() { content = ''; closed = true; return Promise.resolve(); },
      });
    },
  };
}

export function nativeDirectoryHandle(entry: NativeDirectoryEntry): ProjectDirectoryHandle {
  return {
    kind: 'directory', name: entry.name,
    async *values() {
      const { entries } = await nativeCall(NativeFileDialog.listDirectory(entry));
      for (const child of entries) yield child.kind === 'directory' ? nativeDirectoryHandle(child) : fileHandle(child);
    },
    async getFileHandle(name, options) {
      const { file } = await nativeCall(NativeFileDialog.getDirectoryFile({ ...entry, name, create: options?.create ?? false }));
      return fileHandle(file);
    },
    async queryPermission() { return (await nativeCall(NativeFileDialog.directoryPermission(entry))).granted ? 'granted' : 'denied'; },
    async requestPermission() { return (await nativeCall(NativeFileDialog.directoryPermission(entry))).granted ? 'granted' : 'denied'; },
  };
}

export async function pickNativeProjectDirectory(): Promise<ProjectDirectoryHandle> {
  const result = await nativeCall(NativeFileDialog.pickDirectory());
  if (result.cancelled) throw new DOMException('Ordnerauswahl abgebrochen.', 'AbortError');
  if (!result.directory) throw Error('Android hat keinen Projektordner zurückgegeben.');
  return nativeDirectoryHandle(result.directory);
}

export async function rememberedNativeProjectDirectory(clear = false): Promise<ProjectDirectoryHandle | undefined> {
  if (clear) { await nativeCall(NativeFileDialog.clearRememberedDirectory()); return undefined; }
  const { directory } = await nativeCall(NativeFileDialog.rememberedDirectory());
  return directory ? nativeDirectoryHandle(directory) : undefined;
}
