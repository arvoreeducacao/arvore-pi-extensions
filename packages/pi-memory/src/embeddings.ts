import OpenAI from "openai";
import { getConfig } from "./config.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const config = getConfig();
  const openai = getClient();

  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}

export async function embedSingle(text: string): Promise<number[]> {
  const [vector] = await embed([text]);
  return vector;
}
