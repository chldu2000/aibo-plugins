import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import xtermStyle from '@xterm/xterm/css/xterm.css';
const style=document.createElement('style');style.textContent=xtermStyle;document.head.append(style);
const zh=navigator.language.startsWith('zh');
const text=(cn,en)=>zh?cn:en;
document.body.innerHTML=`<main><header><nav aria-label="${text('终端标签','Terminal tabs')}"></nav><button id="new">＋ ${text('新终端','New')}</button><button id="settings">${text('Shell 设置','Shell settings')}</button></header><p id="error" role="alert" hidden></p><section id="panes"></section><footer><span id="status"></span><button id="retry" hidden>${text('重新打开','Reopen')}</button><button id="close" hidden>${text('关闭终端','Close terminal')}</button></footer></main><dialog id="confirm"><form method="dialog"><p></p><div><button type="button" value="cancel">${text('取消','Cancel')}</button><button type="button" value="yes">${text('结束终端','End terminal')}</button></div></form></dialog><dialog id="config"><form><h2>${text('默认 Shell','Default shell')}</h2><p>${text('留空可跟随系统。设置仅影响新终端。','Follow the system or override it for new terminals.')}</p><label>${text('Shell 路径','Shell path')}<input name="path" autocomplete="off" spellcheck="false" placeholder="/bin/zsh"></label><label>${text('参数（JSON 数组）','Arguments (JSON array)')}<textarea name="args" spellcheck="false">[]</textarea></label><div><button type="button" id="reset">${text('恢复跟随系统','Follow system')}</button><button type="button" id="cancel">${text('取消','Cancel')}</button><button type="submit">${text('保存','Save')}</button></div></form></dialog>`;
const $=selector=>document.querySelector(selector);
for(const button of document.querySelectorAll('#confirm button')) button.onclick=()=>$('#confirm').close(button.value);
let port, serial=0, active=null, stopped=false, settings=null;
const pending=new Map(), entries=new Map(), cursors={};
function rpc(request) {
  if (!port || stopped) return Promise.reject(Error(text('终端连接已断开，请重新加载工具。','Disconnected. Reload the tool.')));
  const id=++serial;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Tool request timed out'));},15000);
    pending.set(id,{resolve,reject,timeout});port.postMessage({id,request});
  });
}
function error(value) {$('#error').textContent=String(value?.message??value);$('#error').hidden=false;}
function clearError() {$('#error').hidden=true;}
function status() {
  const entry=entries.get(active);$('#close').hidden=!entry;$('#retry').hidden=!entry || entry.info.running;
  $('#status').textContent=entry?(entry.info.error??(entry.replaying?text('正在恢复显示…','Restoring view…'):entry.info.running?entry.info.shell:`${text('已退出','Exited')} · ${entry.info.exitCode??'—'} · ${entry.info.shell}`)):text('没有打开的终端','No terminals');
}
function select(id) {
  active=id;
  for (const [key,entry] of entries) {entry.pane.hidden=key!==id;entry.button.setAttribute('aria-selected',String(key===id));}
  const entry=entries.get(id);if(entry) requestAnimationFrame(()=>{fit(entry);entry.term.focus();});status();
}
function fit(entry) {
  if(entry.pane.hidden || entry.pane.clientWidth<20 || entry.pane.clientHeight<20) return;
  entry.fit.fit();
}
function attach(info,replaying=false) {
  let entry=entries.get(info.id);
  if(entry) {entry.info=info;status();return entry;}
  const pane=document.createElement('div');pane.className='terminal';pane.hidden=true;$('#panes').append(pane);
  const button=document.createElement('button');button.textContent=`${text('终端','Terminal')} ${info.id}`;button.setAttribute('role','tab');button.onclick=()=>select(info.id);$('nav').append(button);
  const term=new Terminal({fontSize:13,fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',scrollback:3000,convertEol:false,allowProposedApi:false,theme:{background:'#15171b',foreground:'#e6e8ed'},cursorBlink:true,disableStdin:replaying});
  const addon=new FitAddon();term.loadAddon(addon);term.open(pane);
  entry={info,pane,button,term,fit:addon,replaying,replayEnd:null};entries.set(info.id,entry);cursors[info.id]=0;
  term.onData(data=>{if(entry.info.running && !entry.replaying) void rpc({action:'input',id:info.id,data}).catch(error);});
  term.onResize(({cols,rows})=>{if(entry.info.running) void rpc({action:'resize',id:info.id,cols:Math.min(500,cols),rows:Math.min(500,rows)}).catch(error);});
  // xterm's native copy/paste handlers preserve bracketed paste and IME composition.
  term.attachCustomKeyEventHandler(event=>!((event.metaKey || (event.ctrlKey&&event.shiftKey)) && ['c','v'].includes(event.key.toLowerCase())));
  return entry;
}
async function create() {clearError();const info=await rpc({action:'create',cols:80,rows:24});attach(info);select(info.id);}
async function confirmClose(entry) {
  if(!entry.info.running) return true;
  const dialog=$('#confirm');dialog.querySelector('p').textContent=text('关闭会结束此终端及其运行的程序。继续？','Close this terminal and end its running programs?');
  dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='yes'),{once:true}));
}
async function closeCurrent() {
  const entry=entries.get(active);if(!entry || !await confirmClose(entry))return;
  await rpc({action:'close',id:entry.info.id});entry.term.dispose();entry.pane.remove();entry.button.remove();entries.delete(entry.info.id);delete cursors[entry.info.id];select(entries.keys().next().value??null);
}
async function read() {
  try {
    const updates=await rpc({action:'read',cursors});
    for(const {info,output} of updates) {
      const entry=attach(info);if(entry.replaying && entry.replayEnd===null)entry.replayEnd=output.end;
      if(output.truncated){entry.term.reset();entry.term.writeln(text('[较早输出已超出内存保留范围]','[Earlier output exceeded the memory limit]'));}
      const data=Uint8Array.from(atob(output.data),c=>c.charCodeAt(0));
      if(data.length) await new Promise(resolve=>entry.term.write(data,resolve));
      cursors[info.id]=output.cursor;
      if(entry.replaying && output.cursor>=entry.replayEnd){entry.replaying=false;entry.term.options.disableStdin=false;if(entry.info.running)await rpc({action:"resize",id:info.id,cols:Math.min(500,entry.term.cols),rows:Math.min(500,entry.term.rows)});}
    }
    status();if(!stopped)setTimeout(read,50);
  } catch(value) {error(value);stopped=true;}
}
$('#new').onclick=()=>void create().catch(error);
$('#close').onclick=()=>void closeCurrent().catch(error);
$('#retry').onclick=()=>void (async()=>{await closeCurrent();await create();})().catch(error);
$('#settings').onclick=()=>{const form=$('#config form');form.elements.path.value=settings?.path??'';form.elements.args.value=JSON.stringify(settings?.args??[]);$('#config').showModal();};
$('#cancel').onclick=()=>$('#config').close();
async function save(value) {await rpc({action:'settings',settings:value});settings=value;$('#config').close();clearError();}
$('#reset').onclick=()=>void save(null).catch(error);
$('#config form').onsubmit=event=>{event.preventDefault();try {const form=event.currentTarget;const path=form.elements.path.value.trim();void save(path?{path,args:JSON.parse(form.elements.args.value)}:null).catch(error);}catch(value){error(value);}};
new ResizeObserver(()=>{const entry=entries.get(active);if(entry)fit(entry);}).observe($('#panes'));
window.addEventListener('message',async event=>{
  if(event.source!==parent || event.data?.type!=='aibo.tool-view.connect' || port || !event.ports[0])return;
  port=event.ports[0];port.onmessage=({data})=>{const item=pending.get(data.id);if(!item)return;pending.delete(data.id);clearTimeout(item.timeout);if(data.error)item.reject(Error(data.error));else item.resolve(data.result);};port.start();
  try {const result=await rpc({action:'list'});settings=result.settings;for(const info of result.terminals)attach(info,true);if(result.fresh)await create();else select(entries.keys().next().value??null);void read();}catch(value){error(value);}
});
