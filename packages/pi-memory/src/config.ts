const DEFAULT_API_URL = "https://api.arvore.com.br/api-arvore";

export interface PiMemoryConfig {
  apiUrl: string;
  embeddingModel: string;
  incognito: boolean;
}

export function getConfig(): PiMemoryConfig {
  return {
    apiUrl: process.env.PI_MEMORY_API_URL || DEFAULT_API_URL,
    embeddingModel: "text-embedding-3-small",
    incognito: false,
  };
}
