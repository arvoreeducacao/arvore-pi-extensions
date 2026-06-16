const DEFAULT_API_URL = "https://livros.arvore.com.br/api-arvore";

export interface PiMemoryConfig {
  apiUrl: string;
}

export function getConfig(): PiMemoryConfig {
  return {
    apiUrl: process.env.PI_MEMORY_API_URL || DEFAULT_API_URL,
  };
}
