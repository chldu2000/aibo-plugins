// Registers the target host's SDK resolver, so plugin sources import @aibolabs/* exactly as the
// packaged Worker does at runtime. The host is ../aibo unless AIBO_ROOT points elsewhere.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));
export const aiboRoot = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
await import(pathToFileURL(path.join(aiboRoot, 'packages/plugin-host/register.mjs')).href);
