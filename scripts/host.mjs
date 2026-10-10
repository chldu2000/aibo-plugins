// Where SDK modules and host contracts come from. By default both come from npm: the SDK pinned by the
// lockfiles and the contracts shipped in @aibolabs/plugin-protocol. AIBO_ROOT or AIBO_SDK=local uses the
// host checkout instead (../aibo unless AIBO_ROOT points elsewhere), to verify against unreleased host sources.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
export const aiboRoot = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
export const useHost = Boolean(process.env.AIBO_ROOT) || process.env.AIBO_SDK === 'local';

/** `node --import` URL that injects the SDK installed under `directory`, as the host does for a packaged Worker. */
export const sdkPreload = directory => useHost
  ? pathToFileURL(path.join(aiboRoot, 'packages/plugin-host/register.mjs')).href
  : `${new URL('sdk-loader.mjs', import.meta.url).href}?dir=${encodeURIComponent(directory)}`;

export function contractPath(name) {
  if (useHost) return path.join(aiboRoot, 'contracts', name);
  return fileURLToPath(import.meta.resolve(`@aibolabs/plugin-protocol/contracts/${name}`));
}
export const contract = async name => JSON.parse(await readFile(contractPath(name), 'utf8'));
