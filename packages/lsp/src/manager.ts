import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { LspClient } from "./client.js";
import type {
  Diagnostic,
  Hover,
  Location,
  LocationLink,
  Position,
  PublishDiagnosticsParams,
  WorkspaceEdit,
} from "./protocol.js";
import {
  type LanguageServerConfig,
  languageIdForPath,
  serverForPath,
} from "./registry.js";

interface ServerInstance {
  config: LanguageServerConfig;
  rootPath: string;
  client: LspClient;
  ready: Promise<void>;
  openDocs: Map<string, number>;
  diagnostics: Map<string, Diagnostic[]>;
  available: boolean;
}

export type Notifier = (message: string, level?: "info" | "warning" | "error") => void;

function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  return fileURLToPath(uri);
}

export class LspManager {
  private servers = new Map<string, ServerInstance>();
  private commandChecked = new Map<string, boolean>();

  constructor(
    private readonly cwd: string,
    private readonly notify: Notifier,
  ) {}

  private absPath(filePath: string): string {
    return isAbsolute(filePath) ? filePath : resolve(this.cwd, filePath);
  }

  private commandExists(command: string): boolean {
    if (this.commandChecked.has(command)) return this.commandChecked.get(command)!;
    let ok = false;
    try {
      execSync(`command -v ${command}`, { stdio: "ignore", cwd: this.cwd });
      ok = true;
    } catch {
      ok = false;
    }
    this.commandChecked.set(command, ok);
    return ok;
  }

  private findRoot(filePath: string, config: LanguageServerConfig): string {
    let dir = dirname(this.absPath(filePath));
    let lastMatch: string | null = null;
    const segments = dir.split(sep).length;
    for (let i = 0; i < segments; i++) {
      for (const marker of config.rootMarkers) {
        if (existsSync(join(dir, marker))) {
          lastMatch = dir;
          if (marker === ".git") return dir;
          break;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return lastMatch ?? dirname(this.absPath(filePath));
  }

  private instanceKey(config: LanguageServerConfig, rootPath: string): string {
    return `${config.id}:${rootPath}`;
  }

  private async getOrCreate(filePath: string): Promise<ServerInstance | null> {
    const config = serverForPath(filePath);
    if (!config) return null;

    const rootPath = this.findRoot(filePath, config);
    const key = this.instanceKey(config, rootPath);
    const existing = this.servers.get(key);
    if (existing) {
      if (!existing.available) return null;
      if (!existing.client.isRunning()) {
        this.servers.delete(key);
      } else {
        await existing.ready;
        return existing;
      }
    }

    if (!this.commandExists(config.command)) {
      this.notify(
        `LSP: "${config.command}" not found. Install it to enable ${config.label} support.`,
        "warning",
      );
      this.servers.set(key, {
        config,
        rootPath,
        client: new LspClient({ command: config.command, args: config.args, cwd: rootPath }),
        ready: Promise.resolve(),
        openDocs: new Map(),
        diagnostics: new Map(),
        available: false,
      });
      return null;
    }

    const client = new LspClient({ command: config.command, args: config.args, cwd: rootPath });
    const instance: ServerInstance = {
      config,
      rootPath,
      client,
      ready: Promise.resolve(),
      openDocs: new Map(),
      diagnostics: new Map(),
      available: true,
    };

    client.on("diagnostics", (params: PublishDiagnosticsParams) => {
      instance.diagnostics.set(uriToPath(params.uri), params.diagnostics);
    });
    client.on("exit", () => {
      this.servers.delete(key);
    });
    client.on("spawn_error", (err: unknown) => {
      instance.available = false;
      this.notify(`LSP: failed to start ${config.label}: ${String(err)}`, "error");
    });

    instance.ready = this.initialize(instance);
    this.servers.set(key, instance);
    await instance.ready;
    return instance.available ? instance : null;
  }

  private async initialize(instance: ServerInstance): Promise<void> {
    const { client, rootPath } = instance;
    client.start();
    const rootUri = pathToFileURL(rootPath).toString();
    try {
      await client.request("initialize", {
        processId: process.pid,
        rootPath,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: rootPath }],
        initializationOptions: instance.config.initializationOptions,
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: false },
            publishDiagnostics: { relatedInformation: true },
            hover: { contentFormat: ["markdown", "plaintext"] },
            definition: { linkSupport: true },
            references: {},
            rename: { prepareSupport: false },
          },
          workspace: { workspaceFolders: true, configuration: true },
        },
      });
      client.notify("initialized", {});
      client.notify("workspace/didChangeConfiguration", { settings: {} });
    } catch (err) {
      instance.available = false;
      this.notify(`LSP: initialize failed for ${instance.config.label}: ${String(err)}`, "error");
    }
  }

  private async ensureOpen(instance: ServerInstance, filePath: string): Promise<string> {
    const abs = this.absPath(filePath);
    const uri = pathToFileURL(abs).toString();
    let text: string;
    try {
      text = readFileSync(abs, "utf-8");
    } catch {
      throw new Error(`cannot read file: ${abs}`);
    }

    const openVersion = instance.openDocs.get(uri);
    if (openVersion === undefined) {
      instance.openDocs.set(uri, 1);
      instance.client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: languageIdForPath(abs), version: 1, text },
      });
    } else {
      const version = openVersion + 1;
      instance.openDocs.set(uri, version);
      instance.client.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
    return uri;
  }

  private async waitForDiagnostics(instance: ServerInstance, path: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        instance.client.off("diagnostics", onDiag);
        resolve();
      };
      const onDiag = (params: PublishDiagnosticsParams) => {
        if (uriToPath(params.uri) === path) {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, 350);
        }
      };
      let quietTimer = setTimeout(finish, timeoutMs);
      instance.client.on("diagnostics", onDiag);
    });
  }

  async diagnostics(filePath: string): Promise<{ path: string; diagnostics: Diagnostic[] } | null> {
    const instance = await this.getOrCreate(filePath);
    if (!instance) return null;
    const abs = this.absPath(filePath);
    await this.ensureOpen(instance, filePath);
    await this.waitForDiagnostics(instance, abs, 6_000);
    return { path: abs, diagnostics: instance.diagnostics.get(abs) ?? [] };
  }

  async definition(filePath: string, position: Position): Promise<Location[] | null> {
    const instance = await this.getOrCreate(filePath);
    if (!instance) return null;
    const uri = await this.ensureOpen(instance, filePath);
    const result = await instance.client.request<Location | Location[] | LocationLink[] | null>(
      "textDocument/definition",
      { textDocument: { uri }, position },
    );
    return normalizeLocations(result);
  }

  async references(filePath: string, position: Position): Promise<Location[] | null> {
    const instance = await this.getOrCreate(filePath);
    if (!instance) return null;
    const uri = await this.ensureOpen(instance, filePath);
    const result = await instance.client.request<Location[] | null>("textDocument/references", {
      textDocument: { uri },
      position,
      context: { includeDeclaration: false },
    });
    return result ?? [];
  }

  async hover(filePath: string, position: Position): Promise<Hover | null> {
    const instance = await this.getOrCreate(filePath);
    if (!instance) return null;
    const uri = await this.ensureOpen(instance, filePath);
    return instance.client.request<Hover | null>("textDocument/hover", {
      textDocument: { uri },
      position,
    });
  }

  async rename(filePath: string, position: Position, newName: string): Promise<WorkspaceEdit | null> {
    const instance = await this.getOrCreate(filePath);
    if (!instance) return null;
    const uri = await this.ensureOpen(instance, filePath);
    return instance.client.request<WorkspaceEdit | null>("textDocument/rename", {
      textDocument: { uri },
      position,
      newName,
    });
  }

  async disposeAll(): Promise<void> {
    const all = [...this.servers.values()];
    this.servers.clear();
    await Promise.all(all.map((i) => i.client.dispose().catch(() => {})));
  }
}

function normalizeLocations(
  result: Location | Location[] | LocationLink[] | null,
): Location[] {
  if (!result) return [];
  const arr = Array.isArray(result) ? result : [result];
  return arr.map((item) => {
    if ("targetUri" in item) {
      return { uri: item.targetUri, range: item.targetSelectionRange ?? item.targetRange };
    }
    return item;
  });
}
