// Minimal JSON-RPC over JSONL for driving a packaged Worker from the smoke tests.
import { createInterface } from 'node:readline';

/** Returns `send(method, params)` resolving to the result, and `close()` which expects a clean exit. */
export function jsonlRpc(child, onNotification = () => {}) {
  let nextId = 0;
  const pending = new Map();
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    const message = JSON.parse(line);
    if (message.method) return onNotification(message);
    const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  const exited = new Promise(resolve => child.once('exit', code => {
    for (const waiter of pending.values()) waiter.reject(new Error(`Worker exited ${code} with requests pending`));
    pending.clear(); resolve(code);
  }));
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const close = async (timeoutMs = 3_000) => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const code = await exited; clearTimeout(timer);
    if (code !== 0) throw new Error(`Worker exited ${code}`);
  };
  return { send, close };
}
