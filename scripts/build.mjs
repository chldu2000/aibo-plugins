import { mkdtemp, mkdir, copyFile, cp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));
const aibo = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
const hostPath = (...parts) => path.join(aibo, ...parts);

/** Build actual SDK tarballs and a separate consumer; no workspace links or app imports. */
async function buildExternalPlugin() {
  await mkdir(path.join(project,'dist'),{recursive:true});
  const root=await mkdtemp(path.join(project,'dist','build-'));
  const cache=path.join(root,'npm-cache');
  const tsc=hostPath('node_modules/typescript/bin/tsc');
  const protocol=path.join(root,'protocol'),sdk=path.join(root,'sdk'),consumer=path.join(root,'consumer');
  await mkdir(protocol);await mkdir(sdk);
  const pack=directory=>JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--cache',cache],{cwd:directory,encoding:'utf8'}))[0];
  for(const name of ['package.json','README.md']) await copyFile(hostPath('packages/plugin-protocol',name),path.join(protocol,name));
  execFileSync(process.execPath,[tsc,'-p',hostPath('packages/plugin-protocol/tsconfig.json'),'--outDir',path.join(protocol,'dist')]);
  const protocolTar=path.join(protocol,pack(protocol).filename);
  for(const name of ['package.json','README.md','runtime.mjs','stdio.mjs','runtime.d.ts','stdio.d.ts']) await copyFile(hostPath('packages/capability-runtime',name),path.join(sdk,name));
  const sdkTar=path.join(sdk,pack(sdk).filename);
  await cp(path.join(project,'plugins/capability'),consumer,{recursive:true});
  execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',cache,protocolTar,sdkTar],{cwd:consumer,stdio:'pipe'});
  await copyFile(path.join(project,'plugins/capability/package.json'),path.join(consumer,'package.json'));
  execFileSync(process.execPath,[tsc,'-p','tsconfig.json'],{cwd:consumer,stdio:'pipe'});
  const archive=pack(consumer);
  if(!archive.files.some(file=>file.path==='dist/worker.js') || !archive.files.some(file=>file.path==='node_modules/@aibo/capability-runtime/stdio.mjs')) throw Error('External archive is missing its worker or SDK');
  if(archive.files.some(file=>/svelte|\.css$|\.tsx?$/.test(file.path.replace(/\.d\.ts$/,'.types')))) throw Error('External runtime archive contains frontend or uncompiled source');
  const packagePath=path.join(root,'unpacked');await mkdir(packagePath);
  execFileSync('tar',['-xzf',path.join(consumer,archive.filename),'-C',packagePath,'--strip-components=1']);
  const evidence={externalDirectory:true,offlineSdkTarballs:true,compiledWithoutDom:true,bundledRuntime:true,files:archive.files.map(file=>file.path)};
  await writeFile(path.join(root,'build-evidence.json'),JSON.stringify(evidence,null,2));
  const presentationTools = path.join(root, 'presentation-tools');
  await cp(hostPath('packages/presentation-tools'), presentationTools, {recursive:true});
  const toolsArchive = pack(presentationTools);
  const unpackedTools = path.join(root, 'tools'); await mkdir(unpackedTools);
  execFileSync('tar', ['-xzf', path.join(presentationTools,toolsArchive.filename), '-C', unpackedTools, '--strip-components=1']);
  const { buildPresentation } = await import(pathToFileURL(path.join(unpackedTools,'build.mjs')).href);
  const presentationPath = path.join(root, 'presentation');
  await buildPresentation(path.join(project,'plugins/presentation/presentation.source.json'), presentationPath);
  return {capability:packagePath,presentation:presentationPath};
}

try { console.log(JSON.stringify(await buildExternalPlugin(), null, 2)); }
catch (error) { console.error(error); process.exitCode = 1; }
