import { getCredentials } from "./auth.js";
import { getConfig } from "./config.js";

export interface IngestChunk {
  id: string;
  content: string;
  vector: number[];
  metadata: {
    session_id: string;
    timestamp: number;
    topic?: string;
    turn_index?: number;
    extra?: Record<string, unknown>;
  };
}

export interface SearchResult {
  id: string;
  score: number;
  content: string;
  session_id?: string;
  timestamp?: number;
  topic?: string;
  turn_index?: number;
}

export async function ingest(chunks: IngestChunk[]): Promise<{ ingested: number }> {
  const creds = await getCredentials();
  if (!creds) throw new Error("Not authenticated. Run /memory-login first.");

  const config = getConfig();
  const response = await fetch(`${config.apiUrl}/pi-memory/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.token}`,
    },
    body: JSON.stringify({ chunks }),
  });

  if (!response.ok) {
    throw new Error(`Ingest failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<{ ingested: number }>;
}

export async function search(
  vector: number[],
  options: { limit?: number; score_threshold?: number; session_id?: string } = {},
): Promise<SearchResult[]> {
  const creds = await getCredentials();
  if (!creds) throw new Error("Not authenticated. Run /memory-login first.");

  const config = getConfig();
  const response = await fetch(`${config.apiUrl}/pi-memory/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.token}`,
    },
    body: JSON.stringify({ vector, ...options }),
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<SearchResult[]>;
}
