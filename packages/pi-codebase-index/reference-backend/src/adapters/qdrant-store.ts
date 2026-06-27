import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  SearchFilter,
  StoredChunk,
  VectorMatch,
  VectorPoint,
  VectorStore,
} from "../ports.js";

const COLLECTION = process.env.QDRANT_COLLECTION || "codebase_index";

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;

  constructor() {
    const url = process.env.QDRANT_URL || "http://localhost:6333";
    const apiKey = process.env.QDRANT_API_KEY;
    this.client = new QdrantClient({ url, apiKey });
  }

  async init(dimension: number): Promise<void> {
    const { collections } = await this.client.getCollections();
    if (collections.some((c) => c.name === COLLECTION)) {
      return;
    }
    await this.client.createCollection(COLLECTION, {
      vectors: { size: dimension, distance: "Cosine" },
    });
    for (const field of ["org", "repo", "path", "lang"]) {
      await this.client.createPayloadIndex(COLLECTION, {
        field_name: field,
        field_schema: "keyword",
      });
    }
  }

  static pointId(org: string, repo: string, path: string, symbol: string): string {
    const hash = createHash("md5").update(`${org}:${repo}:${path}:${symbol}`).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(COLLECTION, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload as unknown as Record<string, unknown>,
      })),
    });
  }

  async deleteByPath(org: string, repo: string, path: string): Promise<void> {
    await this.client.delete(COLLECTION, {
      wait: true,
      filter: {
        must: [
          { key: "org", match: { value: org } },
          { key: "repo", match: { value: repo } },
          { key: "path", match: { value: path } },
        ],
      },
    });
  }

  async listFileHashes(org: string, repo: string): Promise<Map<string, string>> {
    const byPath = new Map<string, string>();
    let offset: string | number | undefined;
    do {
      const result = await this.client.scroll(COLLECTION, {
        limit: 1000,
        offset,
        with_payload: ["path", "fileHash"],
        filter: {
          must: [
            { key: "org", match: { value: org } },
            { key: "repo", match: { value: repo } },
          ],
        },
      });
      for (const point of result.points) {
        const payload = point.payload as { path?: string; fileHash?: string } | null;
        if (payload?.path && payload.fileHash) {
          byPath.set(payload.path, payload.fileHash);
        }
      }
      offset = (result.next_page_offset as string | number | null) ?? undefined;
    } while (offset !== undefined && offset !== null);
    return byPath;
  }

  async search(
    vector: number[],
    filter: SearchFilter,
    limit: number,
    threshold: number
  ): Promise<VectorMatch[]> {
    const must: Record<string, unknown>[] = [{ key: "org", match: { value: filter.org } }];
    if (filter.repo) must.push({ key: "repo", match: { value: filter.repo } });
    if (filter.lang) must.push({ key: "lang", match: { value: filter.lang } });

    const results = await this.client.search(COLLECTION, {
      vector,
      limit,
      score_threshold: threshold,
      filter: { must },
      with_payload: true,
    });

    return results.map((r) => ({
      score: r.score,
      payload: r.payload as unknown as StoredChunk,
    }));
  }
}
