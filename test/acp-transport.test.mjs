import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AcpTransport } from '../plugins/cursor/acp-transport.mjs';

function fakeProcess() {
  const child=new EventEmitter();
  child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.exitCode=null;child.signalCode=null;
  child.kill=signal=>{child.signalCode=signal;queueMicrotask(()=>child.emit('exit',null,signal));return true;};
  return child;
}

function frames(stream) {
  let buffer='';const values=[];
  stream.on('data',chunk=>{buffer+=chunk;let newline;while((newline=buffer.indexOf('\n'))>=0){values.push(JSON.parse(buffer.slice(0,newline)));buffer=buffer.slice(newline+1);}});
  return values;
}

test('ACP transport correlates responses and preserves request id zero', async () => {
  const child=fakeProcess();const written=frames(child.stdin);
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
  const pending=transport.request('initialize',{protocolVersion:1});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(written[0].id,1);
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:1}})}\n`);
  assert.deepEqual(await pending,{protocolVersion:1});
  transport.onRequest(message=>{transport.respond(message.id,{ok:true});return true;});
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:0,method:'client/test',params:{}})}\n`);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(written.at(-1),{jsonrpc:'2.0',id:0,result:{ok:true}});
  await transport.close();
});

test('ACP transport rejects pending work on malformed output and bounds stderr diagnostics', async () => {
  const child=fakeProcess();
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace',requestTimeoutMs:1_000}).start();
  const pending=transport.request('initialize',{});
  child.stderr.write('private diagnostic');
  child.stdout.write('{not json}\n');
  await assert.rejects(pending,/malformed JSON/);
  assert.equal(transport.closed,true);
  assert.equal(child.signalCode,'SIGTERM');
});

test('unknown and failing ACP client methods return JSON-RPC errors', async () => {
  const child=fakeProcess();const written=frames(child.stdin);
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:'missing',method:'unknown',params:{}})}\n`);
  transport.onRequest(()=>{throw new Error('handler failed')});
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:'broken',method:'broken',params:{}})}\n`);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(written[0].error.code,-32601);
  assert.deepEqual(written[1].error,{code:-32603,message:'handler failed'});
  await transport.close();
});
