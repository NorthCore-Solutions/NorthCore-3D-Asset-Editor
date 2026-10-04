const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = (value: string | Uint8Array) => typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);

/** Canonical metadata; original JSON is deliberately never canonicalized. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw Error('Archive metadata must be JSON serializable.');
  return encoded;
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
