import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type RpcEvent = Record<string, unknown> & { type: string };

export interface RpcClientOptions {
  bin: string;
  cwd: string;
  model?: string;
  onEvent: (event: RpcEvent) => void;
  onExit: (code: number | null) => void;
}

interface PendingResponse {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export class RpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingResponse>();
  private requestCounter = 0;
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private disposed = false;
  private readonly options: RpcClientOptions;

  constructor(options: RpcClientOptions) {
    this.options = options;
    const args = ["--mode", "rpc"];
    if (options.model) {
      args.push("--model", options.model);
    }

    this.child = spawn(options.bin, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.stderr.on("data", (chunk) => {
      process.stderr.write(`[pi] ${chunk}`);
    });
    this.child.on("exit", (code) => {
      this.disposed = true;
      for (const p of this.pending.values()) {
        p.reject(new Error("RPC process exited"));
      }
      this.pending.clear();
      this.options.onExit(code);
    });
  }

  private onData(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    while (true) {
      const i = this.buffer.indexOf("\n");
      if (i === -1) break;
      let line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed.type === "response") {
      const id = parsed.id as string | undefined;
      if (id && this.pending.has(id)) {
        const p = this.pending.get(id)!;
        this.pending.delete(id);
        if (parsed.success) {
          p.resolve((parsed.data as Record<string, unknown>) ?? {});
        } else {
          p.reject(new Error(String(parsed.error ?? "RPC failed")));
        }
      }
      return;
    }
    this.options.onEvent(parsed as RpcEvent);
  }

  private send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.disposed) return Promise.reject(new Error("disposed"));
    const id = `r-${++this.requestCounter}`;
    const payload = JSON.stringify({ ...command, id }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(payload, (err) => {
        if (err) { this.pending.delete(id); reject(err); }
      });
    });
  }

  prompt(message: string, images?: Array<{ type: string; data: string; mimeType: string }>) {
    const cmd: Record<string, unknown> = { type: "prompt", message };
    if (images && images.length > 0) cmd.images = images;
    return this.send(cmd);
  }
  steer(message: string) { return this.send({ type: "steer", message }); }
  abort() { return this.send({ type: "abort" }); }

  respondUi(id: string, response: Record<string, unknown>): void {
    if (this.disposed) return;
    this.child.stdin.write(JSON.stringify({ type: "extension_ui_response", id, ...response }) + "\n");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.child.kill("SIGTERM");
  }
}
