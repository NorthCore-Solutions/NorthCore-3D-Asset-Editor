import { beforeEach, expect, it, vi } from 'vitest';
import type * as NativeFileDialogModule from '../src/platform/nativeFileDialog';

const native = vi.hoisted(() => ({
  isAndroid: vi.fn(), pickDirectory: vi.fn(), rememberedDirectory: vi.fn(), clearRememberedDirectory: vi.fn(),
  directoryPermission: vi.fn(), listDirectory: vi.fn(), getDirectoryFile: vi.fn(), readDocument: vi.fn(), writeDocument: vi.fn(),
}));
vi.mock('../src/platform/nativeFileDialog', async (original) => {
  const module = await original<typeof NativeFileDialogModule>();
  return { ...module, isNativeAndroid: native.isAndroid, NativeFileDialog: native };
});
import { authorizeProjectDirectory, pickProjectDirectory, projectEntries, rememberedProjectDirectory, supportsProjectDirectory, writeProjectFile } from '../src/animation/projectDirectory';

const root = { kind: 'directory' as const, name: 'Projects', treeUri: 'content://provider/tree/root', documentId: 'root' };
const folder = { ...root, name: 'Deep', documentId: 'root/deep' };
const file = { ...folder, kind: 'file' as const, name: 'Ärger.raster128.json', documentId: 'opaque-file-id' };

beforeEach(() => {
  vi.resetAllMocks();
  native.isAndroid.mockReturnValue(true);
  native.pickDirectory.mockResolvedValue({ directory: root });
  native.directoryPermission.mockResolvedValue({ granted: true });
});

it('offers Android folders without window/showDirectoryPicker and cancels quietly', async () => {
  expect(supportsProjectDirectory()).toBe(true);
  const handle = await pickProjectDirectory();
  expect(handle.name).toBe('Projects');
  native.pickDirectory.mockResolvedValue({ cancelled: true });
  await expect(pickProjectDirectory()).rejects.toMatchObject({ name: 'AbortError' });
});

it('restores only the native root descriptor and handles revoked or missing roots', async () => {
  native.rememberedDirectory.mockResolvedValue({ directory: root });
  expect((await rememberedProjectDirectory())?.name).toBe('Projects');
  native.rememberedDirectory.mockResolvedValue({});
  expect(await rememberedProjectDirectory()).toBeUndefined();
  await rememberedProjectDirectory(null);
  expect(native.clearRememberedDirectory).toHaveBeenCalledOnce();
});

it('lists nested SAF IDs freshly, filters non-project files and reads UTF-8 unchanged', async () => {
  const directory = await pickProjectDirectory();
  native.listDirectory.mockResolvedValueOnce({ entries: [file, folder, { ...file, name: 'ignore.txt' }] });
  const entries = await projectEntries(directory);
  expect(entries.map((entry) => entry.name)).toEqual(['Deep', 'Ärger.raster128.json']);
  const nested = entries[0];
  if (!nested || nested.kind !== 'directory') throw Error('Expected directory');
  native.listDirectory.mockResolvedValue({ entries: [file] });
  await projectEntries(nested);
  expect(native.listDirectory).toHaveBeenLastCalledWith(folder);
  native.getDirectoryFile.mockResolvedValue({ file });
  native.readDocument.mockResolvedValue({ base64: Buffer.from('{"name":"Grüße 🦊"}').toString('base64') });
  const handle = await nested.getFileHandle(file.name);
  expect(await (await handle.getFile()).text()).toBe('{"name":"Grüße 🦊"}');
  expect(native.readDocument).toHaveBeenCalledWith(file);
});

it('creates in the selected subfolder, writes on close and truncates through the native writer', async () => {
  const rootDirectory = await pickProjectDirectory();
  native.listDirectory.mockResolvedValue({ entries: [folder] });
  const [directory] = await projectEntries(rootDirectory);
  if (!directory || directory.kind !== 'directory') throw Error('Expected subfolder');
  native.getDirectoryFile.mockResolvedValue({ file });
  const handle = await directory.getFileHandle(file.name, { create: true });
  expect(native.getDirectoryFile).toHaveBeenCalledWith({ ...folder, name: file.name, create: true });
  const writer = await handle.createWritable();
  await writer.write('discard'); await writer.abort();
  expect(native.writeDocument).not.toHaveBeenCalled();
  await writeProjectFile(handle, '{"name":"Ä"}');
  expect(native.writeDocument).toHaveBeenCalledWith({ ...file, base64: Buffer.from('{"name":"Ä"}').toString('base64') });
  native.writeDocument.mockRejectedValue({ code: 'NotAllowedError', message: 'Grant revoked' });
  await expect(writeProjectFile(handle, '{}')).rejects.toMatchObject({ name: 'NotAllowedError' });
});

it('preserves NotFound for create/overwrite decisions and reauthorizes with a new picker root', async () => {
  const directory = await pickProjectDirectory();
  native.getDirectoryFile.mockRejectedValue({ code: 'NotFoundError', message: 'Missing' });
  await expect(directory.getFileHandle('missing.raster128.json')).rejects.toMatchObject({ name: 'NotFoundError' });
  native.directoryPermission.mockResolvedValue({ granted: false });
  expect(await directory.queryPermission({ mode: 'readwrite' })).toBe('denied');
  native.pickDirectory.mockResolvedValue({ directory: folder });
  expect((await authorizeProjectDirectory(directory))?.name).toBe('Deep');
});
