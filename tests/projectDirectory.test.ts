/* eslint-disable @typescript-eslint/require-await -- In-memory mocks implement asynchronous filesystem methods. */
import { afterEach, expect, it, vi } from 'vitest';
import { pickProjectDirectory, projectEntries, projectFileName, projectFlyoutPosition, supportsProjectDirectory, writeProjectFile } from '../src/animation/projectDirectory';
import type { ProjectDirectoryHandle, ProjectFileHandle } from '../src/animation/projectDirectory';

afterEach(() => vi.unstubAllGlobals());
it('filters files, sorts directories first and rereads the authoritative folder', async () => {
  const entries = [
    { name: 'z.raster128.json', kind: 'file' }, { name: 'ignored.json', kind: 'file' },
    { name: 'B', kind: 'directory' }, { name: 'a', kind: 'directory' }, { name: 'A.RASTER128.JSON', kind: 'file' },
  ];
  const directory = { async *values() { yield* entries; } } as unknown as ProjectDirectoryHandle;
  expect((await projectEntries(directory)).map((e) => e.name)).toEqual(['a', 'B', 'A.RASTER128.JSON', 'z.raster128.json']);
  entries.push({ name: 'new.raster128.json', kind: 'file' });
  expect((await projectEntries(directory)).some((e) => e.name === 'new.raster128.json')).toBe(true);
});
it('uses a native picker only when supported, including cancellation without fallback errors', async () => {
  vi.stubGlobal('window', {});
  expect(supportsProjectDirectory()).toBe(false);
  expect(pickProjectDirectory).toThrow('nicht unterstützt');
  const picker = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  vi.stubGlobal('window', { showDirectoryPicker: picker });
  expect(supportsProjectDirectory()).toBe(true);
  await expect(pickProjectDirectory()).rejects.toMatchObject({ name: 'AbortError' });
  expect(picker).toHaveBeenCalledWith({ mode: 'readwrite' });
});
it('writes then closes atomically, aborting a failed write', async () => {
  const writer = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
  const file = { createWritable: async () => writer } as unknown as ProjectFileHandle;
  await writeProjectFile(file, '{"version":2}');
  expect(writer.write).toHaveBeenCalledWith('{"version":2}'); expect(writer.close).toHaveBeenCalledOnce();
  writer.write.mockRejectedValue(new Error('Disk full'));
  await expect(writeProjectFile(file, '{}')).rejects.toThrow('Disk full');
  expect(writer.abort).toHaveBeenCalledOnce(); expect(writer.close).toHaveBeenCalledOnce();
});
it('normalizes only the filename, preventing accidental paths', () => {
  expect(projectFileName('../Project/name')).toBe('.._Project_name.raster128.json');
  expect(projectFileName('Animation.raster128.json')).toBe('Animation.raster128.json');
  expect(() => projectFileName('..')).toThrow();
});
it('offsets each flyout right and down, mirrors at the right edge and clamps vertically', () => {
  expect(projectFlyoutPosition({ left: 100, right: 300, top: 100 }, 260, 400, { width: 1440, height: 1000 })).toEqual({ left: 306, top: 108 });
  expect(projectFlyoutPosition({ left: 1100, right: 1300, top: 900 }, 260, 400, { width: 1440, height: 1000 })).toEqual({ left: 834, top: 592 });
  expect(projectFlyoutPosition({ left: 0, right: 200, top: 0 }, 260, 300, { width: 300, height: 400 })).toEqual({ left: 8, top: 8 });
});
