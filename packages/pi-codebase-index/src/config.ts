export interface PiCodebaseConfig {
  apiUrl: string;
  authProvider: string;
}

const EXAMPLE_URL = "https://your-backend.example.com/api";

export function getConfig(): PiCodebaseConfig {
  const apiUrl = process.env.PI_CODEBASE_API_URL;

  if (!apiUrl) {
    throw new Error(
      "PI_CODEBASE_API_URL is not set. Point it at a backend that implements the " +
        `Codebase Index Protocol (see PROTOCOL.md). Example: PI_CODEBASE_API_URL=${EXAMPLE_URL}`
    );
  }

  return {
    apiUrl,
    authProvider: process.env.PI_CODEBASE_AUTH_PROVIDER || "github",
  };
}
