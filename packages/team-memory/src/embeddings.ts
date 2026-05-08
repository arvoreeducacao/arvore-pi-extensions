type Pipeline = (texts: string[], options?: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>;

const DEFAULT_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

export class EmbeddingEngine {
  private pipeline: Pipeline | null = null;
  private modelName: string;
  private ready = false;

  constructor(modelName?: string) {
    this.modelName = modelName || process.env.MEMORY_EMBEDDING_MODEL || DEFAULT_MODEL;
  }

  async init(): Promise<void> {
    try {
      const { pipeline, env } = await import("@xenova/transformers");
      if (process.env.TRANSFORMERS_CACHE_DIR) {
        env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
      }
      this.pipeline = (await pipeline(
        "feature-extraction",
        this.modelName
      )) as unknown as Pipeline;
      this.ready = true;
      console.error(`Embedding engine ready (model: ${this.modelName})`);
    } catch (error) {
      console.error(
        `Failed to init embedding engine: ${error instanceof Error ? error.message : error}. Falling back to keyword search.`
      );
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.pipeline) throw new Error("Embedding engine not initialized");

    const output = await this.pipeline([text], {
      pooling: "mean",
      normalize: true,
    });
    return output.tolist()[0];
  }
}
