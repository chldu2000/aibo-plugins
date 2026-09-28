import { cp, lstat, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Ship the locked JS production graph and licenses; Claude itself is installed by the user. */
export async function packageRuntime(source, destination, cache) {
  await cp(source, destination, { recursive: true, filter: file => path.basename(file) !== 'node_modules' });
  execFileSync('npm', ['ci', '--offline', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-bin-links', '--no-audit', '--no-fund', '--cache', cache],
    { cwd: destination, stdio: 'pipe' });
  // Types and source maps are not runtime inputs. Avoid archive size/file limits.
  // Keep package.json, JS, data resources, READMEs and licenses.
  const { rm } = await import('node:fs/promises');
  async function prune(directory) {
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name), stat = await lstat(file);
      if (stat.isSymbolicLink()) throw Error(`Runtime dependency contains a symlink: ${file}`);
      if (stat.isDirectory()) await prune(file);
      else if (/\.(ts|mts|cts|map)$/.test(name)) await rm(file);
    }
  }
  await prune(path.join(destination, 'node_modules'));
}
