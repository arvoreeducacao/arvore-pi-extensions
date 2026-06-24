export interface LanguageServerConfig {
  id: string;
  label: string;
  languageId: string;
  command: string;
  args: string[];
  extensions: string[];
  rootMarkers: string[];
  initializationOptions?: Record<string, unknown>;
}

export const LANGUAGE_SERVERS: LanguageServerConfig[] = [
  {
    id: "typescript",
    label: "TypeScript / JavaScript",
    languageId: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
  },
];

export function languageIdForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return "typescriptreact";
  if (lower.endsWith(".jsx")) return "javascriptreact";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  return "plaintext";
}

export function serverForPath(filePath: string): LanguageServerConfig | undefined {
  const lower = filePath.toLowerCase();
  return LANGUAGE_SERVERS.find((s) => s.extensions.some((ext) => lower.endsWith(ext)));
}
