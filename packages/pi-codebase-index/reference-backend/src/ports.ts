export interface Embedder {
  dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface StoredChunk {
  org: string;
  repo: string;
  path: string;
  symbol: string;
  lang: string;
  gitSha: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  content: string;
  fileHash: string | null;
}

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: StoredChunk;
}

export interface SearchFilter {
  org: string;
  repo?: string;
  lang?: string;
}

export interface VectorMatch {
  score: number;
  payload: StoredChunk;
}

export interface VectorStore {
  init(dimension: number): Promise<void>;
  upsert(points: VectorPoint[]): Promise<void>;
  deleteByPath(org: string, repo: string, path: string): Promise<void>;
  listFileHashes(org: string, repo: string): Promise<Map<string, string>>;
  search(
    vector: number[],
    filter: SearchFilter,
    limit: number,
    threshold: number
  ): Promise<VectorMatch[]>;
}
