import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { join, basename, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type {
  MemoryEntry,
  MemoryCatalogEntry,
  MemoryCategory,
  MemoryStatus,
  MemoryFrontmatter,
} from "./types.js";
import { VALID_CATEGORIES, MemoryError } from "./types.js";
import { resolveGitAuthor } from "./git-identity.js";

function detectSteeringTargets(workspaceRoot: string): string[] {
  const targets: string[] = [];

  const kiroSteering = join(workspaceRoot, ".kiro", "steering");
  if (existsSync(kiroSteering)) {
    targets.push(kiroSteering);
  }

  const cursorRules = join(workspaceRoot, ".cursor", "rules");
  if (existsSync(cursorRules)) {
    targets.push(cursorRules);
  }

  return targets;
}

export class MemoryStore {
  private memoriesPath: string;
  private workspaceRoot: string;
  private catalog: MemoryEntry[] = [];
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor(memoriesPath: string) {
    this.memoriesPath = memoriesPath;
    this.workspaceRoot = this.resolveWorkspaceRoot(memoriesPath);
  }

  private resolveWorkspaceRoot(memoriesPath: string): string {
    const abs = resolve(memoriesPath);
    return dirname(abs);
  }

  async load(): Promise<void> {
    this.loadingPromise = this.doLoad();
    return this.loadingPromise;
  }

  private async doLoad(): Promise<void> {
    this.catalog = [];

    if (!existsSync(this.memoriesPath)) {
      await mkdir(this.memoriesPath, { recursive: true });
    }

    for (const category of VALID_CATEGORIES) {
      const catDir = join(this.memoriesPath, category);
      if (!existsSync(catDir)) continue;

      const files = await readdir(catDir);
      const mdFiles = files.filter((f) => f.endsWith(".md"));

      for (const file of mdFiles) {
        const filePath = join(catDir, file);
        const entry = await this.parseMemoryFile(filePath, category);
        if (entry) this.catalog.push(entry);
      }
    }

    this.catalog.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    this.loaded = true;
    await this.syncSteeringIndex();
  }

  async syncSteeringIndex(): Promise<void> {
    try {
      const targets = detectSteeringTargets(this.workspaceRoot);
      if (targets.length === 0) return;

      const active = this.catalog.filter((m) => m.status === "active");
      const grouped = new Map<string, MemoryEntry[]>();

      for (const entry of active) {
        const list = grouped.get(entry.category) || [];
        list.push(entry);
        grouped.set(entry.category, list);
      }

      const lines: string[] = [
        "# Team Memories Index",
        "",
        `Total: ${active.length} active memories. Use \`get_memory(id)\` to read full content.`,
        "",
      ];

      for (const category of VALID_CATEGORIES) {
        const entries = grouped.get(category);
        if (!entries || entries.length === 0) continue;

        lines.push(`## ${category} (${entries.length})`);
        lines.push("");

        for (const entry of entries) {
          const tags =
            entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
          lines.push(`- **${entry.title}**${tags} → \`${entry.id}\``);
        }

        lines.push("");
      }

      const body = lines.join("\n");

      for (const target of targets) {
        const filePath = join(target, "team-memories-index.md");
        const content = `---\ninclusion: always\nname: team-memories-index\n---\n\n${body}\n`;
        await writeFile(filePath, content, "utf-8");
      }
    } catch (error) {
      console.error(
        `Failed to sync steering index: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private parseFrontmatter(raw: string): {
    data: Partial<MemoryFrontmatter>;
    content: string;
  } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { data: {}, content: raw };

    const data: Record<string, unknown> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value: unknown = line.slice(idx + 1).trim();

      if (
        typeof value === "string" &&
        value.startsWith("[") &&
        value.endsWith("]")
      ) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim());
      }
      data[key] = value;
    }

    return { data: data as Partial<MemoryFrontmatter>, content: match[2] };
  }

  private buildFrontmatter(data: Record<string, unknown>): string {
    const lines = ["---"];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        lines.push(`${key}: [${value.join(", ")}]`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push("---");
    return lines.join("\n");
  }

  private async parseMemoryFile(
    filePath: string,
    fallbackCategory?: string
  ): Promise<MemoryEntry | null> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const { data: fm, content } = this.parseFrontmatter(raw);

      const id = basename(filePath, ".md");
      const category = (fm.category || fallbackCategory || "domain") as MemoryCategory;

      return {
        id,
        path: filePath,
        title: fm.title || id,
        category,
        date: fm.date || new Date().toISOString().split("T")[0],
        author: fm.author,
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        status: (fm.status as MemoryStatus) || "active",
        content: content.trim(),
      };
    } catch {
      return null;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadingPromise) {
      this.loadingPromise = this.doLoad();
    }
    await this.loadingPromise;
  }

  async search(
    query: string,
    opts?: { category?: MemoryCategory; status?: MemoryStatus; limit?: number }
  ): Promise<(MemoryCatalogEntry & { score: number })[]> {
    await this.ensureLoaded();

    const status = opts?.status || "active";
    const limit = opts?.limit || 10;

    let filtered = this.catalog.filter((m) => m.status === status);
    if (opts?.category) {
      filtered = filtered.filter((m) => m.category === opts.category);
    }
    return this.keywordSearch(query, filtered, limit);
  }

  private keywordSearch(
    query: string,
    entries: MemoryEntry[],
    limit: number
  ): (MemoryCatalogEntry & { score: number })[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = entries.map((entry) => {
      let score = 0;

      for (const term of queryTerms) {
        if (entry.title.toLowerCase().includes(term)) score += 10;
        if (entry.tags.some((t) => t.toLowerCase().includes(term))) score += 8;
        if (entry.category.toLowerCase().includes(term)) score += 5;
        if (entry.content.toLowerCase().includes(term)) score += 3;
        if (entry.author?.toLowerCase().includes(term)) score += 2;
      }

      return { entry, score: score / 10 };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => ({ ...this.toCatalogEntry(s.entry), score: round(s.score) }));
  }

  async list(opts?: {
    category?: MemoryCategory;
    status?: MemoryStatus;
    limit?: number;
  }): Promise<MemoryCatalogEntry[]> {
    await this.ensureLoaded();

    let filtered = [...this.catalog];

    if (opts?.category) {
      filtered = filtered.filter((m) => m.category === opts.category);
    }
    if (opts?.status) {
      filtered = filtered.filter((m) => m.status === opts.status);
    }

    const limit = opts?.limit || 50;
    return filtered.slice(0, limit).map((e) => this.toCatalogEntry(e));
  }

  async get(id: string): Promise<MemoryEntry | null> {
    await this.ensureLoaded();
    return this.catalog.find((m) => m.id === id) || null;
  }

  async add(params: {
    title: string;
    category: MemoryCategory;
    content: string;
    tags?: string[];
    author?: string;
  }): Promise<MemoryEntry> {
    await this.ensureLoaded();

    const catDir = join(this.memoriesPath, params.category);
    await mkdir(catDir, { recursive: true });

    const date = new Date().toISOString().split("T")[0];
    const slug = params.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const id = `${date}-${slug}`;
    const filePath = join(catDir, `${id}.md`);

    const author = params.author || (await resolveGitAuthor(this.workspaceRoot));

    const fm: Record<string, unknown> = {
      title: params.title,
      category: params.category,
      date,
      status: "active",
    };
    if (author) fm.author = author;
    if (params.tags?.length) fm.tags = params.tags;

    const fileContent = `${this.buildFrontmatter(fm)}\n\n${params.content}\n`;
    await writeFile(filePath, fileContent, "utf-8");

    const entry: MemoryEntry = {
      id,
      path: filePath,
      title: params.title,
      category: params.category,
      date,
      author,
      tags: params.tags || [],
      status: "active",
      content: params.content,
    };

    this.catalog.unshift(entry);
    await this.syncSteeringIndex();

    return entry;
  }

  async archive(id: string): Promise<MemoryEntry> {
    await this.ensureLoaded();

    const entry = await this.get(id);
    if (!entry) {
      throw new MemoryError(`Memory "${id}" not found`, "NOT_FOUND");
    }

    entry.status = "archived";

    const raw = await readFile(entry.path, "utf-8");
    const { data, content } = this.parseFrontmatter(raw);
    data.status = "archived";
    const updated = `${this.buildFrontmatter(data as Record<string, unknown>)}\n${content}`;
    await writeFile(entry.path, updated, "utf-8");

    await this.syncSteeringIndex();

    return entry;
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();

    const entry = await this.get(id);
    if (!entry) {
      throw new MemoryError(`Memory "${id}" not found`, "NOT_FOUND");
    }

    await rm(entry.path);
    this.catalog = this.catalog.filter((m) => m.id !== id);

    await this.syncSteeringIndex();
  }

  private toCatalogEntry(entry: MemoryEntry): MemoryCatalogEntry {
    const snippet =
      entry.content.length > 200
        ? entry.content.slice(0, 200) + "..."
        : entry.content;

    return {
      id: entry.id,
      title: entry.title,
      category: entry.category,
      date: entry.date,
      author: entry.author,
      tags: entry.tags,
      status: entry.status,
      snippet,
    };
  }

  getCatalog(): MemoryEntry[] {
    return [...this.catalog];
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
