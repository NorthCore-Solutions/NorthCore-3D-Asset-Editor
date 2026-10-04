import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Run after Vite build: all specialized authoring, rendering and packaged assets are gone.
const forbidden = /LegacyBuilder|LegacyCanvas|legacyStore|legacyPersistence|legacy-authoring|legacy1024|Legacy1024|LegacyMigrationPanel|LegacyTemplateImport|NativeFaceInspector|RasterOperationsInspector|beginFacePreview|previewFaceSlot|retargetFacePose|replayRasterRecipe|local-nearest-8-v1|fino-standing-neutral-128|fino-standing-active-128|standing_neutral-face-free|Editor-Modus/;
const retired = ['legacy.ts', 'nativeFaces.ts', 'nativePoses.ts', 'rasterOperations.ts', 'NativeFaceInspector.tsx', 'RasterOperationsInspector.tsx', 'migration'];
for (const entry of retired) if (existsSync(resolve('src/animation', entry))) throw new Error(`Retired production module: ${entry}`);
for (const file of readdirSync('dist', { recursive: true }).map(String)) {
  if (forbidden.test(file) || /animation[/\\]legacy[/\\]/.test(file)) throw new Error(`Retired output: ${file}`);
  if (/\.(js|css|html|json)$/.test(file) && forbidden.test(readFileSync(resolve('dist', file), 'utf8')))
    throw new Error(`Retired production content: ${file}`);
}
const resources = readdirSync('dist/animation', { recursive: true }).map(String).filter((file) => /\.(png|json)$/.test(file));
if (resources.length !== 6 || resources.some((file) => !/^tracing[/\\]fino_.*_128\.png$/.test(file))) throw new Error('Only the six tracing references may ship as animation assets.');
console.log('Production bundle contains only Raster128 authoring and the six tracing references; retired systems are absent.');
