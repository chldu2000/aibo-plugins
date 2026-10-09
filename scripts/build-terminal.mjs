import { readFile, writeFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
export async function buildTerminal({output=path.join(project,'dist','terminal'),target=process.env.CARGO_BUILD_TARGET}={}) {
  const source=path.join(project,'plugins/terminal');
  const {build}=await import(pathToFileURL(path.join(source,'node_modules/esbuild/lib/main.js')).href);
  const result=await build({entryPoints:[path.join(source,'frontend.js')],bundle:true,write:false,format:'iife',minify:true,loader:{'.css':'text'},target:'es2022'});
  const js=result.outputFiles[0].text.replaceAll('</script','<\\/script');
  const css=await readFile(path.join(source,'style.css'),'utf8');
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><script>${js}</script></body></html>`;
  const cargo=['build','--locked','--release','--manifest-path',path.join(source,'backend/Cargo.toml')];if(target)cargo.push('--target',target);
  execFileSync('cargo',cargo,{stdio:'inherit'});
  const platform=target?(target.includes('windows')?'windows':target.includes('apple')?'darwin':'linux'):(process.platform==='win32'?'windows':process.platform);
  const arch=target?(target.startsWith('aarch64')?'arm64':'x64'):process.arch;
  const executable=platform==='windows'?'terminal.exe':'terminal';
  await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'frontend.html'),html);
  await copyFile(path.join(source,'backend/target',...(target?[target]:[]),'release',platform==='windows'?'aibo-terminal.exe':'aibo-terminal'),path.join(output,executable));
  await chmod(path.join(output,executable),0o755);
  const manifest={schema:'aibo.plugin-manifest/v2',pluginId:'dev.aibo.terminal',version:'0.1.0',displayName:'Terminal · 终端',description:'Interactive local terminals. Runs with your OS user permissions, independently of chat mode.',host:{min:'0.1.1',maxExclusive:'0.2.0'},platforms:[`${platform}-${arch}`],contributions:[{kind:'toolView',id:'dev.aibo.terminal.workspace',scope:'workspace',required:true,title:'Terminal · 终端',contractVersion:'1.0.0',frontend:'frontend.html',backend:executable,permissions:['local.process']}]};
  await writeFile(path.join(output,'plugin.json'),JSON.stringify(manifest,null,2)+'\n');
  return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) console.log(await buildTerminal());
