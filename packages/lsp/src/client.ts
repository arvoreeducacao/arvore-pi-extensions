import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  PublishDiagnosticsParams,
  RpcId,
  RpcNotification,
  RpcRequest,
  RpcResponse,
} from "./protocol.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  method: string;
}

const HEADER_SEPARATOR = "\r\n\r\n";

export interface LspClientOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export class LspClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<RpcId, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private disposed = false;

  constructor(private readonly options: LspClientOptions) {
    super();
  }

  start(): void {
    if (this.proc) return;
    this.proc = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString("utf-8"));
    });
    this.proc.on("exit", (code, sig) => {
      this.emit("exit", code, sig);
      this.rejectAll(new Error(`language server exited (code=${code} signal=${sig})`));
    });
    this.proc.on("error", (err) => {
      this.emit("spawn_error", err);
      this.rejectAll(err);
    });
  }

  isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.disposed;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 20_000): Promise<T> {
    if (!this.proc) return Promise.reject(new Error("language server not started"));
    const id = this.nextId++;
    const payload: RpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`LSP request "${method}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      });

      this.write(payload);
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.proc) return;
    const payload: RpcNotification = { jsonrpc: "2.0", method, params };
    this.write(payload);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.proc && this.proc.exitCode === null) {
      try {
        await this.request("shutdown", undefined, 3_000).catch(() => {});
        this.notify("exit");
      } catch {}
      const proc = this.proc;
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          proc.kill("SIGKILL");
          resolve();
        }, 2_000);
        proc.once("exit", () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
    }
    this.rejectAll(new Error("language server disposed"));
    this.proc = null;
  }

  private write(message: RpcRequest | RpcNotification): void {
    this.writeRaw(message);
  }

  private writeRaw(message: RpcRequest | RpcNotification | RpcResponse): void {
    if (!this.proc || this.proc.stdin.destroyed) return;
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}${HEADER_SEPARATOR}`;
    this.proc.stdin.write(header + body);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) return;

      const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + HEADER_SEPARATOR.length);
        continue;
      }

      const contentLength = Number(match[1]);
      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      if (this.buffer.length < bodyStart + contentLength) return;

      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf-8");
      this.buffer = this.buffer.subarray(bodyStart + contentLength);

      try {
        this.handleMessage(JSON.parse(body));
      } catch (err) {
        this.emit("parse_error", err);
      }
    }
  }

  private handleMessage(message: RpcResponse & RpcNotification): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      this.emit("diagnostics", message.params as PublishDiagnosticsParams);
      return;
    }

    if (message.id !== undefined && message.method) {
      this.writeRaw({
        jsonrpc: "2.0",
        id: message.id,
        result: this.defaultServerRequestResult(message.method),
      });
    }
  }

  private defaultServerRequestResult(method: string): unknown {
    switch (method) {
      case "workspace/configuration":
        return [null];
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
        return null;
      default:
        return null;
    }
  }

  private rejectAll(reason: unknown): void {
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }
}
