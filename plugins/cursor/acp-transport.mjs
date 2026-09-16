import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export class AcpTransport {
  constructor({ command = 'agent', args = ['acp'], cwd, spawnProcess = spawn, requestTimeoutMs = 30_000 } = {}) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.spawnProcess = spawnProcess;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.requestHandlers = new Set();
    this.notificationHandlers = new Set();
    this.stderr = '';
    this.closed = false;
  }

  start() {
    if (this.child) throw new Error('Cursor ACP process already started');
    const child = this.spawnProcess(this.command, this.args, {
      cwd: this.cwd,
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines = lines;
    lines.on('line', line => this.#receiveLine(line));
    child.stderr.on('data', chunk => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-MAX_STDERR_BYTES);
    });
    child.once('error', error => this.#finish(error));
    child.once('exit', (code, signal) => {
      const detail = this.stderr.trim().slice(-2_000);
      this.#finish(new Error(`Cursor ACP exited (${signal ?? code ?? 'unknown'})${detail ? `: ${detail}` : ''}`), false);
    });
    return this;
  }

  onRequest(handler) { this.requestHandlers.add(handler); return () => this.requestHandlers.delete(handler); }
  onNotification(handler) { this.notificationHandlers.add(handler); return () => this.notificationHandlers.delete(handler); }

  request(method, params, timeoutMs = this.requestTimeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Cursor ACP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.#write({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method, params) { this.#write({ jsonrpc: '2.0', method, params }); }
  respond(id, result) { this.#write({ jsonrpc: '2.0', id, result }); }
  respondError(id, code, message) { this.#write({ jsonrpc: '2.0', id, error: { code, message } }); }

  async close({ forceAfterMs = 2_000 } = {}) {
    if (!this.child || this.closed) return;
    this.closed = true;
    this.lines?.close();
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.child?.kill('SIGKILL'); resolve(); }, forceAfterMs);
      this.child?.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.#rejectPending(new Error('Cursor ACP transport closed'));
  }

  #write(message) {
    if (!this.child || this.closed || !this.child.stdin.writable) throw new Error('Cursor ACP transport is not writable');
    const frame = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) throw new Error('Cursor ACP frame exceeds 8 MiB');
    this.child.stdin.write(frame);
  }

  #receiveLine(line) {
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES) return this.#finish(new Error('Cursor ACP frame exceeds 8 MiB'));
    let message;
    try { message = JSON.parse(line); }
    catch { return this.#finish(new Error('Cursor ACP emitted malformed JSON')); }
    if (message?.jsonrpc !== '2.0') return this.#finish(new Error('Cursor ACP emitted an invalid JSON-RPC envelope'));
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message ?? `${pending.method} failed`), { code: message.error.code, data: message.error.data }));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method !== 'string') return;
    if (message.id !== undefined) {
      try {
        for (const handler of this.requestHandlers) if (handler(message) === true) return;
      } catch (error) {
        this.respondError(message.id, -32603, String(error?.message ?? error).slice(0, 2_000));
        return;
      }
      this.respondError(message.id, -32601, 'Method not found');
      return;
    }
    try { for (const handler of this.notificationHandlers) handler(message); }
    catch (error) { this.#finish(error instanceof Error ? error : new Error(String(error))); }
  }

  #finish(error, terminate = true) {
    if (this.closed && !this.pending.size) return;
    this.closed = true;
    this.lines?.close();
    if (terminate && this.child && this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
    this.#rejectPending(error);
    for (const handler of this.notificationHandlers) {
      try { handler({ jsonrpc: '2.0', method: 'transport/closed', params: { message: error.message } }); }
      catch { /* transport is already terminal */ }
    }
  }

  #rejectPending(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
}
