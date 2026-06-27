export interface PiCodebaseConfig {
  apiUrl: string;
  authProvider: string;
}

const DEFAULT_API_URL = "https://livros.arvore.com.br/api-arvore";

export function getConfig(): PiCodebaseConfig {
  return {
    apiUrl: process.env.PI_CODEBASE_API_URL || DEFAULT_API_URL,
    authProvider: process.env.PI_CODEBASE_AUTH_PROVIDER || "github",
  };
}
