import OpenAI from "openai";
import type { Embedder } from "../ports.js";

export class OpenAIEmbedder implements Embedder {
  readonly dimension: number;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for the OpenAI embedder.");
    }
    this.client = new OpenAI({ apiKey });
    this.model = process.env.EMBEDDING_MODEL || "text-embedding-3-large";
    this.dimension = Number(process.env.EMBEDDING_DIMENSIONS || 1024);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimension,
    });
    return response.data.map((d) => d.embedding);
  }
}
