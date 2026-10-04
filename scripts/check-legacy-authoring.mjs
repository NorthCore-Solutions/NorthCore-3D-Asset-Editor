import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Run after Vite build. Compatibility renderer/assets remain intentionally allowed.
const forbidden = /LegacyBuilder|LegacyCanvas|legacyStore|legacyPersistence|legacy-authoring|legacy1024|Legacy1024|Editor-Modus/;
const files = readdirSync('dist', { recursive: true }).map(String);
for (const file of files) {
  if (forbidden.test(file)) throw new Error(`Legacy authoring output: ${file}`);
  if (/\.(js|css|html)$/.test(file) && forbidden.test(readFileSync(resolve('dist', file), 'utf8')))
    throw new Error(`Legacy authoring content: ${file}`);
}
console.log('Production bundle contains no Legacy1024 authoring or mode UI.');
