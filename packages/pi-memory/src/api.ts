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

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const creds = await getCredentials();
  if (!creds) throw new Error("Not authenticated. Run /memory-login first.");

  const config = getConfig();
  const response = await fetch(`${config.apiUrl}/pi-memory${path}`, {
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

export function ingest(sessionId: string, messages: IngestMessage[], final: boolean): Promise<IngestResult> {
  return request<IngestResult>("/ingest", "POST", {
    session_id: sessionId,
    messages,
    final,
  });
}

export async function search(
  query: string,
  options: { tier?: string; category?: string; limit?: number } = {},
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
