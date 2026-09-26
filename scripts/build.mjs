import { mkdtemp, mkdir, copyFile, cp, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));
const aibo = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
const hostPath = (...parts) => path.join(aibo, ...parts);

/** Build actual SDK tarballs and a separate consumer; no workspace links or app imports. */
export async function buildExternalPlugin() {
  await mkdir(path.join(project,'dist'),{recursive:true});
  const root=await mkdtemp(path.join(project,'dist','build-'));
  const cache=path.join(root,'npm-cache');
  const tsc=hostPath('node_modules/typescript/bin/tsc');
  const protocol=path.join(root,'protocol'),sdk=path.join(root,'sdk');
  await mkdir(protocol);await mkdir(sdk);
  const pack=directory=>JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--cache',cache],{cwd:directory,encoding:'utf8'}))[0];
  for(const name of ['package.json','README.md']) await copyFile(hostPath('packages/plugin-protocol',name),path.join(protocol,name));
  execFileSync(process.execPath,[tsc,'-p',hostPath('packages/plugin-protocol/tsconfig.json'),'--outDir',path.join(protocol,'dist')]);
  const protocolTar=path.join(protocol,pack(protocol).filename);
  for(const name of ['package.json','README.md','runtime.mjs','stdio.mjs','runtime.d.ts','stdio.d.ts','host-tools.mjs','host-tools.d.ts','host-tools-mcp.mjs','host-tools-mcp.d.ts']) await copyFile(hostPath('packages/capability-runtime',name),path.join(sdk,name));
  const sdkTar=path.join(sdk,pack(sdk).filename);
  async function buildCapabilityPackage(name,{compile=false,entry}) {
    const source=path.join(project,'plugins',name),consumer=path.join(root,`${name}-consumer`);
    await cp(source,consumer,{recursive:true});
    execFileSync('npm',['install','--save-dev','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',cache,protocolTar,sdkTar],{cwd:consumer,stdio:'pipe'});
    await copyFile(path.join(source,'package.json'),path.join(consumer,'package.json'));
    if(compile) execFileSync(process.execPath,[tsc,'-p','tsconfig.json'],{cwd:consumer,stdio:'pipe'});
    const archive=pack(consumer);
    if(!archive.files.some(file=>file.path===entry)) throw Error(`${name} archive is missing its worker`);
    if(archive.files.some(file=>file.path.startsWith('node_modules/@aibo/'))) throw Error('Host SDK must not be bundled');
    if(archive.files.some(file=>/svelte|\.css$|\.tsx?$/.test(file.path.replace(/\.d\.ts$/,'.types')))) throw Error(`${name} archive contains frontend or uncompiled source`);
    const packagePath=path.join(root,name);await mkdir(packagePath);
    execFileSync('tar',['-xzf',path.join(consumer,archive.filename),'-C',packagePath,'--strip-components=1']);
    return {packagePath,files:archive.files.map(file=>file.path)};
  }
  const capability=await buildCapabilityPackage('capability',{compile:true,entry:'dist/worker.js'});
  const cursor=await buildCapabilityPackage('cursor',{entry:'worker.mjs'});
  const fakeBin=path.join(root,'fake-bin');await mkdir(fakeBin);
  const fakeAgent=path.join(fakeBin,'agent');
  await copyFile(path.join(project,'test/fixtures/fake-cursor-agent.mjs'),fakeAgent);await chmod(fakeAgent,0o755);
  execFileSync(process.execPath,[path.join(project,'scripts/smoke-cursor.mjs'),cursor.packagePath,fakeBin],{cwd:project,stdio:'inherit'});
  const evidence={externalDirectory:true,offlineSdkTarballs:true,compiledWithoutDom:true,bundledRuntime:false,hostSdk:true,packages:{capability:capability.files,cursor:cursor.files}};
  await writeFile(path.join(root,'build-evidence.json'),JSON.stringify(evidence,null,2));
  const presentationTools = path.join(root, 'presentation-tools');
  await cp(hostPath('packages/presentation-tools'), presentationTools, {recursive:true});
  const toolsArchive = pack(presentationTools);
  const unpackedTools = path.join(root, 'tools'); await mkdir(unpackedTools);
  execFileSync('tar', ['-xzf', path.join(presentationTools,toolsArchive.filename), '-C', unpackedTools, '--strip-components=1']);
  const { buildPresentation } = await import(pathToFileURL(path.join(unpackedTools,'build.mjs')).href);
  const presentationPath = path.join(root, 'presentation');
  await buildPresentation(path.join(project,'plugins/presentation/presentation.source.json'), presentationPath);
  return {capability:capability.packagePath,cursor:cursor.packagePath,presentation:presentationPath};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await buildExternalPlugin(), null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
