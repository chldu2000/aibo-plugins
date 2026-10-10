// Resolves @aibolabs/* from one directory's node_modules, standing in for the host's SDK resolver: packaged
// Workers do not bundle the SDK, so tests and smoke runs inject it the way Aibo does at runtime.
// `--import ./scripts/sdk-loader.mjs` uses this repository; append `?dir=<absolute path>` to use another directory.
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';

let parentURL;
export function initialize(data) { parentURL = data; }

export function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, specifier.startsWith('@aibolabs/') ? { ...context, parentURL } : context);
}

// Hooks run on a separate loader thread, which imports this module again; only the preload registers them.
if (isMainThread) {
  const directory = new URL(import.meta.url).searchParams.get('dir') ?? fileURLToPath(new URL('../', import.meta.url));
  register('./sdk-loader.mjs', import.meta.url, { data: pathToFileURL(path.join(directory, 'package.json')).href });
}

