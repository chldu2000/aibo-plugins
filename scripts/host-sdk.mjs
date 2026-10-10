// Preload for `pnpm test`: plugin sources import @aibolabs/* exactly as the packaged Worker does at runtime.
// Uses this repository's npm SDK, or the host's own resolver when AIBO_ROOT / AIBO_SDK=local is set (see host.mjs).
import { fileURLToPath } from 'node:url';
import { sdkPreload } from './host.mjs';
export { aiboRoot } from './host.mjs';
await import(sdkPreload(fileURLToPath(new URL('../', import.meta.url))));
