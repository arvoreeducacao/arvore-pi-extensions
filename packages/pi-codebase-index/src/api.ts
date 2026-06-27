import { getCredentials } from "./auth.js";
import { getConfig } from "./config.js";

export interface RepoSync {
  name: string;
  rootHash: string;
  files?: { path: string; hash: string }[];
}

export interface RepoPath {
  repo: string;
  path: string;
}

export interface Chunk {
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

export interface SearchResult {
  repo: string;
  path: string;
  symbol: string;
  lang: string;
  snippet: string;
  score: number;
  lineStart: number | null;
  lineEnd: number | null;
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const creds = await getCredentials();
  if (!creds) throw new Error("Not authenticated. Run /codebase-login first.");

  const config = getConfig();
  const response = await fetch(`${config.apiUrl}/codebase-index${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export function sync(repos: RepoSync[]): Promise<{ changed: RepoPath[]; removed: RepoPath[] }> {
  return request("/sync", "POST", { repos });
}

export function index(chunks: Chunk[], remove?: RepoPath[]): Promise<{ indexed: number }> {
  return request("/index", "POST", { chunks, remove });
}

export async function search(
  query: string,
  options: { repo?: string; lang?: string; limit?: number } = {}
): Promise<SearchResult[]> {
  const data = await request<{ results: SearchResult[] }>("/search", "POST", {
    query,
    ...options,
  });
  return data.results;
}
