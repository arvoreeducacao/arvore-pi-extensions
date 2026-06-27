import type { AuthedUser } from "./auth.js";
import type { Embedder, StoredChunk, VectorPoint, VectorStore } from "./ports.js";
import { QdrantVectorStore } from "./adapters/qdrant-store.js";

export interface RepoSyncInput {
  name: string;
  rootHash: string;
  files?: { path: string; hash: string }[];
}

export interface ChunkInput {
  repo: string;
  path: string;
  symbol: string;
  lang: string;
  gitSha?: string;
  lineStart?: number;
  lineEnd?: number;
  content: string;
  fileHash?: string;
}

export interface RepoPath {
  repo: string;
  path: string;
}

const SEARCH_THRESHOLD = 0.3;
const CANDIDATE_MULTIPLIER = 4;
const GAP_CUTOFF_RATIO = 0.7;
const SNIPPET_MAX_LINES = 15;

export class CodebaseService {
  constructor(
    private readonly store: VectorStore,
    private readonly embedder: Embedder
  ) {}

  async init(): Promise<void> {
    await this.store.init(this.embedder.dimension);
  }

  async sync(user: AuthedUser, repos: RepoSyncInput[]): Promise<{ changed: RepoPath[]; removed: RepoPath[] }> {
    const changed: RepoPath[] = [];
    const removed: RepoPath[] = [];

    for (const repo of repos) {
      const indexed = await this.store.listFileHashes(user.org, repo.name);
      if (!repo.files?.length) continue;

      const incoming = new Map(repo.files.map((f) => [f.path, f.hash]));
      for (const [path, hash] of incoming) {
        if (indexed.get(path) !== hash) {
          changed.push({ repo: repo.name, path });
        }
      }
      for (const path of indexed.keys()) {
        if (!incoming.has(path)) {
          await this.store.deleteByPath(user.org, repo.name, path);
          removed.push({ repo: repo.name, path });
        }
      }
    }

    return { changed, removed };
  }

  async index(user: AuthedUser, chunks: ChunkInput[], remove?: RepoPath[]): Promise<{ indexed: number }> {
    if (remove?.length) {
      for (const item of remove) {
        await this.store.deleteByPath(user.org, item.repo, item.path);
      }
    }
    if (chunks.length === 0) return { indexed: 0 };

    const touched = new Set(chunks.map((c) => `${c.repo}\u0000${c.path}`));
    for (const key of touched) {
      const [repo, path] = key.split("\u0000");
      await this.store.deleteByPath(user.org, repo, path);
    }

    const vectors = await this.embedder.embed(chunks.map((c) => this.embeddingInput(c)));
    const points: VectorPoint[] = chunks.map((chunk, i) => {
      const payload: StoredChunk = {
        org: user.org,
        repo: chunk.repo,
        path: chunk.path,
        symbol: chunk.symbol,
        lang: chunk.lang,
        gitSha: chunk.gitSha ?? null,
        lineStart: chunk.lineStart ?? null,
        lineEnd: chunk.lineEnd ?? null,
        content: chunk.content,
        fileHash: chunk.fileHash ?? null,
      };
      return {
        id: QdrantVectorStore.pointId(user.org, chunk.repo, chunk.path, chunk.symbol),
        vector: vectors[i],
        payload,
      };
    });

    await this.store.upsert(points);
    return { indexed: points.length };
  }

  async search(
    user: AuthedUser,
    query: string,
    options: { repo?: string; lang?: string; limit?: number }
  ) {
    const limit = options.limit ?? 10;
    const [vector] = await this.embedder.embed([query]);
    const matches = await this.store.search(
      vector,
      { org: user.org, repo: options.repo, lang: options.lang },
      limit * CANDIDATE_MULTIPLIER,
      SEARCH_THRESHOLD
    );

    if (matches.length === 0) return { results: [] };

    const sorted = [...matches].sort((a, b) => b.score - a.score);
    const cutoff = sorted[0].score * GAP_CUTOFF_RATIO;
    const kept = sorted.filter((m) => m.score >= cutoff).slice(0, limit);

    return {
      results: kept.map((m) => ({
        repo: m.payload.repo,
        path: m.payload.path,
        symbol: m.payload.symbol,
        lang: m.payload.lang,
        snippet: this.snippet(m.payload.content),
        score: m.score,
        lineStart: m.payload.lineStart,
        lineEnd: m.payload.lineEnd,
      })),
    };
  }

  private embeddingInput(chunk: ChunkInput): string {
    return `[repo:${chunk.repo}] [file:${chunk.path}] [symbol:${chunk.symbol}] [lang:${chunk.lang}]\n${chunk.content}`;
  }

  private snippet(content: string): string {
    const lines = content.split("\n");
    if (lines.length <= SNIPPET_MAX_LINES) return content;
    return `${lines.slice(0, SNIPPET_MAX_LINES).join("\n")}\n…`;
  }
}
