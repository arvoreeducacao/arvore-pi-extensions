import { getCredentials } from "./auth.js";
import { getConfig } from "./config.js";

export interface IngestMessage {
  role: "user" | "assistant";
  text: string;
  turn_index: number;
}

export interface IngestResult {
  processed: number;
  decisions: { add: number; update: number; noop: number };
}

export interface SearchResult {
  id: string;
  tier: "raw" | "curated";
  category: string | null;
  title: string | null;
  content: string;
  score: number;
  relevance_score: number;
  author_username: string;
  updated_at: number;
}

export interface Candidate {
  id: string;
  content: string;
  reinforce_count: number;
  session_id: string | null;
}

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export class MemoryAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryAuthError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

async function formatErrorBody(response: Response): Promise<string> {
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text().catch(() => "");

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as { message?: unknown };
      if (typeof parsed.message === "string") {
        return `${status} ${parsed.message}`;
      }
    } catch {
      // falls through to generic handling
    }
  }

  if (contentType.includes("text/html") || raw.trimStart().startsWith("<")) {
    return `${status} gateway error (HTML response, likely timeout)`;
  }

  const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return snippet ? `${status} ${snippet}` : `${status}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const creds = await getCredentials();
  if (!creds) {
    throw new MemoryAuthError("Not authenticated. Run /memory-login first.");
  }

  const config = getConfig();
  let lastError: Error = new Error(`${method} ${path} failed`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${config.apiUrl}/pi-memory${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkError) {
      lastError = networkError instanceof Error ? networkError : new Error(String(networkError));
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      return response.json() as Promise<T>;
    }

    if (response.status === 401 || response.status === 403) {
      throw new MemoryAuthError(
        `Sessão de memória expirada ou sem acesso (${response.status}). Rode /memory-login.`,
      );
    }

    lastError = new Error(`${method} ${path} failed: ${await formatErrorBody(response)}`);

    if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      continue;
    }

    throw lastError;
  }

  throw lastError;
}

export function ingest(sessionId: string, messages: IngestMessage[], final: boolean): Promise<IngestResult> {
  return request<IngestResult>("/ingest", "POST", {
    session_id: sessionId,
    messages,
    final,
  });
}

export async function search(
  query: string,
  options: { tier?: string; category?: string; limit?: number; threshold?: number } = {},
): Promise<SearchResult[]> {
  const data = await request<{ results: SearchResult[] }>("/search", "POST", { query, ...options });
  return data.results;
}

export function sendFeedback(id: string, useful: boolean): Promise<{ updated: boolean }> {
  return request<{ updated: boolean }>("/feedback", "POST", { id, useful });
}

export async function listCandidates(): Promise<Candidate[]> {
  const data = await request<{ candidates: Candidate[] }>("/candidates", "GET");
  return data.candidates;
}

export function promote(
  rawIds: string[],
  options: { title?: string; category?: string; tags?: string[] } = {},
): Promise<{ id: string }> {
  return request<{ id: string }>("/promote", "POST", { raw_ids: rawIds, ...options });
}

export function createCurated(input: {
  title: string;
  category: string;
  content: string;
  tags?: string[];
}): Promise<{ id: string }> {
  return request<{ id: string }>("/curated", "POST", input);
}

export function deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/session/${sessionId}`, "DELETE");
}
