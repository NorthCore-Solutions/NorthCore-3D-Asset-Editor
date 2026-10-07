import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeSaveFileOptions {
  fileName: string;
  mimeType: string;
  base64: string;
}

interface NativeWriteFileOptions {
  uri: string;
  base64: string;
}

interface NativeSaveFileResult {
  cancelled?: boolean;
  uri?: string;
  name?: string;
}

export interface NativeDirectoryEntry {
  treeUri: string;
  documentId: string;
  name: string;
  kind: 'file' | 'directory';
}

interface NativeDocumentOptions { treeUri: string; documentId: string }

interface NativeFileDialogPlugin {
  saveFile(options: NativeSaveFileOptions): Promise<NativeSaveFileResult>;
  writeFile(options: NativeWriteFileOptions): Promise<void>;
  pickDirectory(): Promise<{ cancelled?: boolean; directory?: NativeDirectoryEntry }>;
  rememberedDirectory(): Promise<{ directory?: NativeDirectoryEntry | null }>;
  clearRememberedDirectory(): Promise<void>;
  directoryPermission(options: NativeDocumentOptions): Promise<{ granted: boolean }>;
  listDirectory(options: NativeDocumentOptions): Promise<{ entries: NativeDirectoryEntry[] }>;
  getDirectoryFile(options: NativeDocumentOptions & { name: string; create: boolean }): Promise<{ file: NativeDirectoryEntry }>;
  readDocument(options: NativeDocumentOptions): Promise<{ base64: string }>;
  writeDocument(options: NativeDocumentOptions & { base64: string }): Promise<void>;
}

export interface SavedFileReference {
  name: string;
  uri: string | null;
}

export const NativeFileDialog = registerPlugin<NativeFileDialogPlugin>('NativeFileDialog');

export const isNativeAndroid = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    let chunk = '';
    for (let index = offset; index < end; index += 1) {
      chunk += String.fromCharCode(bytes[index] ?? 0);
    }
    binary += chunk;
  }

  return btoa(binary);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function saveBlobAs(
  blob: Blob,
  filename: string,
  mimeType: string
): Promise<SavedFileReference | null> {
  if (!isNativeAndroid()) {
    downloadBlob(blob, filename);
    return { name: filename, uri: null };
  }

  const result = await NativeFileDialog.saveFile({
    fileName: filename,
    mimeType,
    base64: await blobToBase64(blob)
  });

  if (result.cancelled) return null;
  if (!result.uri) throw new Error('Android hat keinen Dateipfad zurückgegeben.');

  return {
    name: result.name || filename,
    uri: result.uri
  };
}

export async function overwriteNativeFile(uri: string, blob: Blob): Promise<void> {
  if (!isNativeAndroid()) throw new Error('Native Datei kann nur unter Android überschrieben werden.');
  await NativeFileDialog.writeFile({ uri, base64: await blobToBase64(blob) });
}
