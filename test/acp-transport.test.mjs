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

async function tick() { await new Promise(resolve=>setImmediate(resolve)); }

function frames(stream) {
  let buffer='';const values=[];
  stream.on('data',chunk=>{buffer+=chunk;let newline;while((newline=buffer.indexOf('\n'))>=0){values.push(JSON.parse(buffer.slice(0,newline)));buffer=buffer.slice(newline+1);}});
  return values;
}

test('ACP transport correlates responses and preserves request id zero', async () => {
  const child=fakeProcess();const written=frames(child.stdin);
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
  const pending=transport.request('initialize',{protocolVersion:1});
  await tick();
  assert.equal(written[0].id,1);
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:1}})}\n`);
  assert.deepEqual(await pending,{protocolVersion:1});
  transport.onRequest(message=>{transport.respond(message.id,{ok:true});return true;});
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:0,method:'client/test',params:{}})}\n`);
  await tick();
  assert.deepEqual(written.at(-1),{jsonrpc:'2.0',id:0,result:{ok:true}});
  await transport.close();
});

test('ACP transport rejects pending work on malformed output and bounds stderr diagnostics', async () => {
  const child=fakeProcess();
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace',requestTimeoutMs:1_000}).start();
  const pending=transport.request('initialize',{});
  child.stderr.write(`private diagnostic${'x'.repeat(70*1024)}`);
  child.stdout.write('{not json}\n');
  await assert.rejects(pending,/malformed JSON/);
  assert.ok(Buffer.byteLength(transport.stderr)<=64*1024);
  assert.equal(transport.closed,true);
  assert.equal(child.signalCode,'SIGTERM');
});

test('unknown and failing ACP client methods return JSON-RPC errors', async () => {
  const child=fakeProcess();const written=frames(child.stdin);
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:'missing',method:'unknown',params:{}})}\n`);
  transport.onRequest(()=>{throw new Error('handler failed')});
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:'broken',method:'broken',params:{}})}\n`);
  await tick();
  assert.equal(written[0].error.code,-32601);
  assert.deepEqual(written[1].error,{code:-32603,message:'handler failed'});
  await transport.close();
});

test('ACP transport decodes split UTF-8, partial lines, multiple frames, and CRLF', async () => {
  const child=fakeProcess();
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
  const notices=[];transport.onNotification(message=>notices.push(message));
  const bytes=Buffer.from('{"jsonrpc":"2.0","method":"one","params":{"text":"你好"}}\r\n{"jsonrpc":"2.0","method":"two"}\n');
  const split=bytes.indexOf(Buffer.from('你'))+1;
  child.stdout.write(bytes.subarray(0,split));
  child.stdout.write(bytes.subarray(split,split+2));
  child.stdout.write(bytes.subarray(split+2));
  await tick();
  assert.deepEqual(notices.map(message=>message.method),['one','two']);
  assert.equal(notices[0].params.text,'你好');
  await transport.close();
});

test('ACP transport terminates an oversized unterminated frame', async () => {
  const child=fakeProcess();
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
  const closed=new Promise(resolve=>transport.onNotification(message=>message.method==='transport/closed'&&resolve(message)));
  child.stdout.write(Buffer.alloc(8*1024*1024+1,0x61));
  const event=await closed;
  assert.match(event.params.message,/exceeds 8 MiB/);
  assert.equal(child.signalCode,'SIGTERM');
});

test('ACP transport queues writes while stdin applies backpressure', async () => {
  const child=fakeProcess();const written=frames(child.stdin);
  const originalWrite=child.stdin.write.bind(child.stdin);let calls=0;
  child.stdin.write=(...args)=>{const result=originalWrite(...args);calls+=1;return calls===1?false:result;};
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
  transport.notify('first',{});transport.notify('second',{});
  await tick();assert.equal(written.length,1);
  child.stdin.emit('drain');await tick();
  assert.deepEqual(written.map(frame=>frame.method),['first','second']);
  await transport.close();
});

test('ACP transport settles pending requests on timeout, stdout EOF, and stdin failure', async t => {
  await t.test('timeout', async () => {
    const child=fakeProcess();
    const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace',requestTimeoutMs:5}).start();
    await assert.rejects(transport.request('slow',{}),/slow timed out/);
    assert.equal(transport.pending.size,0);
    await transport.close();
  });
  await t.test('stdout EOF', async () => {
    const child=fakeProcess();
    const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
    const pending=transport.request('initialize',{});child.stdout.end();
    await assert.rejects(pending,/stdout closed/);
    assert.equal(transport.closed,true);
  });
  await t.test('stdin failure', async () => {
    const child=fakeProcess();
    const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
    const pending=transport.request('initialize',{});child.stdin.emit('error',new Error('broken pipe'));
    await assert.rejects(pending,/broken pipe/);
    assert.equal(transport.closed,true);
  });
  await t.test('process exit', async () => {
    const child=fakeProcess();
    const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
    const pending=transport.request('initialize',{});child.emit('exit',7,null);
    await assert.rejects(pending,/exited \(7\)/);
    assert.equal(transport.pending.size,0);
  });
});

test('image prompts can exceed 8 MiB while ordinary frames retain their bound', async () => {
  const child=fakeProcess();const written=frames(child.stdin);
  const transport=new AcpTransport({spawnProcess:()=>child,cwd:'/workspace'}).start();
  const params={sessionId:'image',prompt:[{type:'image',mimeType:'image/png',data:'A'.repeat(9*1024*1024)}]};
  const pending=transport.request('session/prompt',params);
  await tick();
  assert.equal(written[0].params.prompt[0].data.length,9*1024*1024);
  child.stdout.write(`${JSON.stringify({jsonrpc:'2.0',id:1,result:{stopReason:'end_turn'}})}\n`);
  assert.equal((await pending).stopReason,'end_turn');
  await assert.rejects(transport.request('other',params),/exceeds 8 MiB/);
  await transport.close();
});
