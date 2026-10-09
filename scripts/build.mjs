import { mkdtemp, mkdir, copyFile, cp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageRuntime } from './package-runtime.mjs';
import { buildTerminal } from './build-terminal.mjs';
const project = fileURLToPath(new URL('../', import.meta.url));
const aibo = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
const hostPath = (...parts) => path.join(aibo, ...parts);
// SDK development dependencies come from the npm registry by default, pinned by each plugin's lockfile.
// AIBO_SDK=local packs them from the Aibo sources instead, to build against unreleased SDK changes.
const sdkSource = process.env.AIBO_SDK === 'local' ? 'local' : 'registry';
// Lockfiles resolve @aibolabs to the official registry; keep those URLs even when a mirror is configured.
const registryArgs = ['--@aibolabs:registry=https://registry.npmjs.org/', '--replace-registry-host=never'];

/** Build each plugin in a separate consumer with real SDK packages; no workspace links or app imports. */
export async function buildExternalPlugin() {
  await mkdir(path.join(project,'dist'),{recursive:true});
  const root=await mkdtemp(path.join(project,'dist','build-'));
  const cache=sdkSource==='local'?path.join(root,'npm-cache'):path.join(project,'.npm-cache');
  const tsc=path.join(project,'node_modules/typescript/bin/tsc');
  const pack=directory=>JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--cache',cache],{cwd:directory,encoding:'utf8'}))[0];
  const localTarballs=sdkSource==='local'?await packLocalSdk():[];
  async function packLocalSdk() {
    const protocol=path.join(root,'protocol'),sdk=path.join(root,'sdk');
    await mkdir(protocol);await mkdir(sdk);
    for(const name of ['package.json','README.md']) await copyFile(hostPath('packages/plugin-protocol',name),path.join(protocol,name));
    execFileSync(process.execPath,[tsc,'-p',hostPath('packages/plugin-protocol/tsconfig.json'),'--outDir',path.join(protocol,'dist')]);
    const protocolTar=path.join(protocol,pack(protocol).filename);
    for(const name of ['package.json','README.md','runtime.mjs','stdio.mjs','runtime.d.ts','stdio.d.ts','host-tools.mjs','host-tools.d.ts','host-tools-mcp.mjs','host-tools-mcp.d.ts']) await copyFile(hostPath('packages/capability-runtime',name),path.join(sdk,name));
    const sdkTar=path.join(sdk,pack(sdk).filename);
    // Generic ACP session, transport and config parsing; provided by the host SDK at runtime.
    const acp=path.join(root,'acp-adapter');await mkdir(acp);
    const acpManifest=JSON.parse(await readFile(hostPath('packages/acp-adapter/package.json'),'utf8'));
    for(const name of ['package.json',...acpManifest.files]) await copyFile(hostPath('packages/acp-adapter',name),path.join(acp,name));
    return [protocolTar,sdkTar,path.join(acp,pack(acp).filename)];
  }
  async function buildCapabilityPackage(name,{compile=false,entry}) {
    const source=path.join(project,'plugins',name),consumer=path.join(root,`${name}-consumer`);
    await cp(source,consumer,{recursive:true,filter:file=>path.basename(file)!=='node_modules'});
    if (sdkSource==='registry') {
      execFileSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund','--cache',cache,...registryArgs],{cwd:consumer,stdio:'pipe'});
    } else {
      await rm(path.join(consumer,'package-lock.json'),{force:true});
      execFileSync('npm',['install','--save-dev','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',cache,...localTarballs],{cwd:consumer,stdio:'pipe'});
      await copyFile(path.join(source,'package.json'),path.join(consumer,'package.json'));
    }
    if (name === 'claude-code') {
      if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Claude plugin currently publishes darwin-arm64 only; build on that target');
      await packageRuntime(path.join(source, 'runtime'), path.join(consumer, 'vendor'), path.join(project, '.npm-cache'));
    }
    if(compile) execFileSync(process.execPath,[tsc,'-p','tsconfig.json'],{cwd:consumer,stdio:'pipe'});
    const archive=pack(consumer);
    if(!archive.files.some(file=>file.path===entry)) throw Error(`${name} archive is missing its worker`);
    if(archive.files.some(file=>file.path.startsWith('node_modules/@aibolabs/'))) throw Error('Host SDK must not be bundled');
    if(archive.files.some(file=>!file.path.startsWith('vendor/') && /svelte|\.css$|\.tsx?$/.test(file.path.replace(/\.d\.ts$/,'.types')))) throw Error(`${name} archive contains frontend or uncompiled source`);
    if (archive.files.length > 4096 || archive.unpackedSize > 256 * 1024 * 1024) throw Error(`${name} exceeds host package limits`);
    if (name === 'claude-code' && (archive.files.some(file => /node_modules\/@anthropic-ai\/claude-agent-sdk-(darwin|linux|win32)-/.test(file.path) || /\/(claude|claude\.exe)$/.test(file.path))
        || archive.unpackedSize > 32 * 1024 * 1024)) throw Error('Claude plugin must remain a JS adapter package without a bundled Claude executable');
    const packagePath=path.join(root,name);await mkdir(packagePath);
    execFileSync('tar',['-xzf',path.join(consumer,archive.filename),'-C',packagePath,'--strip-components=1']);
    return {packagePath,files:archive.files.map(file=>file.path)};
  }
  const capability=await buildCapabilityPackage('capability',{compile:true,entry:'dist/worker.js'});
  const cursor=await buildCapabilityPackage('cursor',{entry:'worker.mjs'});
  const acpTemplate=await buildCapabilityPackage('acp-template',{entry:'worker.mjs'});
  const claudeCode=await buildCapabilityPackage('claude-code',{entry:'worker.mjs'});
  execFileSync(process.execPath, [path.join(project, 'scripts/smoke-claude-package.mjs'), claudeCode.packagePath], { cwd: project, stdio: 'inherit' });
  const fakeBin=path.join(root,'fake-bin');await mkdir(fakeBin);
  const fakeAgent=path.join(fakeBin,'agent');
  await copyFile(path.join(project,'test/fixtures/fake-cursor-agent.mjs'),fakeAgent);await chmod(fakeAgent,0o755);
  execFileSync(process.execPath,[path.join(project,'scripts/smoke-cursor.mjs'),cursor.packagePath,fakeBin],{cwd:project,stdio:'inherit'});
  const evidence={externalDirectory:true,sdkSource,offlineSdkTarballs:sdkSource==='local',compiledWithoutDom:true,bundledRuntime:false,hostSdk:true,packages:{capability:capability.files,cursor:cursor.files,acpTemplate:acpTemplate.files,claudeCode:claudeCode.files}};
  await writeFile(path.join(root,'build-evidence.json'),JSON.stringify(evidence,null,2));
  let toolsDirectory = path.join(project, 'node_modules/@aibolabs/presentation-tools');
  if (sdkSource === 'local') {
    const presentationTools = path.join(root, 'presentation-tools');
    await cp(hostPath('packages/presentation-tools'), presentationTools, {recursive:true});
    const toolsArchive = pack(presentationTools);
    toolsDirectory = path.join(root, 'tools'); await mkdir(toolsDirectory);
    execFileSync('tar', ['-xzf', path.join(presentationTools,toolsArchive.filename), '-C', toolsDirectory, '--strip-components=1']);
  }
  const { buildPresentation } = await import(pathToFileURL(path.join(toolsDirectory,'build.mjs')).href);
  const presentationPath = path.join(root, 'presentation');
  await buildPresentation(path.join(project,'plugins/presentation/presentation.source.json'), presentationPath);
  const terminal = await buildTerminal({output:path.join(root,"terminal")});
  return {terminal,capability:capability.packagePath,cursor:cursor.packagePath,acpTemplate:acpTemplate.packagePath,claudeCode:claudeCode.packagePath,presentation:presentationPath};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await buildExternalPlugin(), null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
