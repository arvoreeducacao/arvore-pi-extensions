import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface DefNode {
  symbol: string;
  lineStart: number;
  lineEnd: number;
  kind: string;
}

interface LangSpec {
  pkg: string;
  wasm: string;
  defTypes: Set<string>;
  containerTypes: Set<string>;
}

const LANG_SPECS: Record<string, LangSpec> = {
  typescript: {
    pkg: "tree-sitter-typescript",
    wasm: "tree-sitter-typescript",
    defTypes: new Set([
      "function_declaration",
      "class_declaration",
      "method_definition",
      "interface_declaration",
      "type_alias_declaration",
      "enum_declaration",
      "abstract_class_declaration",
    ]),
    containerTypes: new Set(["class_body", "class_declaration", "abstract_class_declaration"]),
  },
  tsx: {
    pkg: "tree-sitter-typescript",
    wasm: "tree-sitter-tsx",
    defTypes: new Set([
      "function_declaration",
      "class_declaration",
      "method_definition",
      "interface_declaration",
      "type_alias_declaration",
      "enum_declaration",
      "abstract_class_declaration",
    ]),
    containerTypes: new Set(["class_body", "class_declaration", "abstract_class_declaration"]),
  },
  javascript: {
    pkg: "tree-sitter-javascript",
    wasm: "tree-sitter-javascript",
    defTypes: new Set(["function_declaration", "class_declaration", "method_definition"]),
    containerTypes: new Set(["class_body", "class_declaration"]),
  },
  python: {
    pkg: "tree-sitter-python",
    wasm: "tree-sitter-python",
    defTypes: new Set(["function_definition", "class_definition"]),
    containerTypes: new Set(["class_definition", "block"]),
  },
  go: {
    pkg: "tree-sitter-go",
    wasm: "tree-sitter-go",
    defTypes: new Set(["function_declaration", "method_declaration", "type_declaration"]),
    containerTypes: new Set(),
  },
  ruby: {
    pkg: "tree-sitter-ruby",
    wasm: "tree-sitter-ruby",
    defTypes: new Set(["method", "class", "module", "singleton_method"]),
    containerTypes: new Set(["class", "module", "body_statement"]),
  },
  rust: {
    pkg: "tree-sitter-rust",
    wasm: "tree-sitter-rust",
    defTypes: new Set([
      "function_item",
      "struct_item",
      "impl_item",
      "enum_item",
      "trait_item",
      "mod_item",
    ]),
    containerTypes: new Set(["impl_item", "mod_item", "declaration_list"]),
  },
  java: {
    pkg: "tree-sitter-java",
    wasm: "tree-sitter-java",
    defTypes: new Set([
      "class_declaration",
      "method_declaration",
      "interface_declaration",
      "constructor_declaration",
      "enum_declaration",
    ]),
    containerTypes: new Set(["class_declaration", "class_body", "interface_body"]),
  },
  kotlin: {
    pkg: "@tree-sitter-grammars/tree-sitter-kotlin",
    wasm: "tree-sitter-kotlin",
    defTypes: new Set(["function_declaration", "class_declaration", "object_declaration"]),
    containerTypes: new Set(["class_declaration", "class_body", "object_declaration"]),
  },
  php: {
    pkg: "tree-sitter-php",
    wasm: "tree-sitter-php",
    defTypes: new Set([
      "function_definition",
      "class_declaration",
      "method_declaration",
      "interface_declaration",
      "trait_declaration",
    ]),
    containerTypes: new Set(["class_declaration", "declaration_list"]),
  },
  c: {
    pkg: "tree-sitter-c",
    wasm: "tree-sitter-c",
    defTypes: new Set(["function_definition", "struct_specifier"]),
    containerTypes: new Set(),
  },
  cpp: {
    pkg: "tree-sitter-cpp",
    wasm: "tree-sitter-cpp",
    defTypes: new Set(["function_definition", "class_specifier", "struct_specifier"]),
    containerTypes: new Set(["class_specifier", "field_declaration_list"]),
  },
  csharp: {
    pkg: "tree-sitter-c-sharp",
    wasm: "tree-sitter-c_sharp",
    defTypes: new Set([
      "class_declaration",
      "method_declaration",
      "struct_declaration",
      "interface_declaration",
      "namespace_declaration",
    ]),
    containerTypes: new Set(["class_declaration", "declaration_list", "namespace_declaration"]),
  },
  elixir: {
    pkg: "tree-sitter-elixir",
    wasm: "tree-sitter-elixir",
    defTypes: new Set(["call"]),
    containerTypes: new Set(["do_block", "call"]),
  },
};

const ELIXIR_DEF_KEYWORDS = new Set([
  "def",
  "defp",
  "defmodule",
  "defmacro",
  "defmacrop",
  "defguard",
  "defprotocol",
  "defimpl",
]);

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rb": "ruby",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cxx": "cpp",
  ".cs": "csharp",
  ".ex": "elixir",
  ".exs": "elixir",
};

export function astLangOf(path: string): string | null {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return LANG_BY_EXT[ext] ?? null;
}

type TreeSitterModule = typeof import("web-tree-sitter");

let parserModule: TreeSitterModule | null = null;
let initPromise: Promise<TreeSitterModule> | null = null;
const languageCache = new Map<string, unknown>();
const failedLanguages = new Set<string>();

function wasmPathFor(spec: LangSpec): string {
  const entry = require.resolve(`${spec.pkg}/package.json`);
  const base = entry.slice(0, entry.lastIndexOf("/"));
  return `${base}/${spec.wasm}.wasm`;
}

async function getModule(): Promise<TreeSitterModule> {
  if (parserModule) {
    return parserModule;
  }
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import("web-tree-sitter");
      await mod.Parser.init();
      parserModule = mod;
      return mod;
    })();
  }
  return initPromise;
}

async function loadLanguage(lang: string): Promise<unknown | null> {
  if (languageCache.has(lang)) {
    return languageCache.get(lang) ?? null;
  }
  if (failedLanguages.has(lang)) {
    return null;
  }
  const spec = LANG_SPECS[lang];
  if (!spec) {
    failedLanguages.add(lang);
    return null;
  }
  try {
    const mod = await getModule();
    const wasmPath = wasmPathFor(spec);
    const language = await mod.Language.load(wasmPath);
    languageCache.set(lang, language);
    return language;
  } catch {
    failedLanguages.add(lang);
    return null;
  }
}

interface TsNode {
  type: string;
  isNamed: boolean;
  childCount: number;
  startPosition: { row: number };
  endPosition: { row: number };
  text: string;
  child(index: number): TsNode | null;
  childForFieldName(name: string): TsNode | null;
}

function firstIdentifier(node: TsNode): string | null {
  if (/identifier|name|alias/i.test(node.type) && node.childCount === 0) {
    return node.text;
  }
  if (node.type === "alias") {
    return node.text;
  }
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (!child) {
      continue;
    }
    const found = firstIdentifier(child);
    if (found) {
      return found;
    }
  }
  return null;
}

function nameOf(node: TsNode, lang: string): string | null {
  if (lang === "elixir") {
    return elixirName(node);
  }
  const named = node.childForFieldName("name");
  if (named?.text) {
    return named.text;
  }
  const declarator = node.childForFieldName("declarator");
  if (declarator) {
    const id = firstIdentifier(declarator);
    if (id) {
      return id;
    }
  }
  return firstIdentifier(node);
}

function elixirKeyword(node: TsNode): string | null {
  const target = node.childForFieldName("target") ?? node.child(0);
  if (target && ELIXIR_DEF_KEYWORDS.has(target.text)) {
    return target.text;
  }
  return null;
}

function elixirName(node: TsNode): string | null {
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (!child) {
      continue;
    }
    if (child.type === "arguments") {
      const id = firstIdentifier(child);
      if (id) {
        return id;
      }
    }
  }
  return null;
}

export async function extractDefs(lang: string, source: string): Promise<DefNode[] | null> {
  const language = await loadLanguage(lang);
  if (!language) {
    return null;
  }
  const spec = LANG_SPECS[lang];
  const mod = parserModule;
  if (!mod || !spec) {
    return null;
  }

  let tree: { rootNode: TsNode; delete?: () => void };
  try {
    const parser = new mod.Parser();
    // biome-ignore lint/suspicious/noExplicitAny: web-tree-sitter Language type is opaque here
    parser.setLanguage(language as any);
    tree = parser.parse(source) as unknown as { rootNode: TsNode; delete?: () => void };
  } catch {
    return null;
  }

  const defs: DefNode[] = [];

  const visit = (node: TsNode, depth: number): void => {
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (!child || !child.isNamed) {
        continue;
      }
      const isDef = isDefinition(child, spec, lang);
      if (isDef) {
        const name = nameOf(child, lang);
        defs.push({
          symbol: name ?? `${child.type}@${child.startPosition.row + 1}`,
          lineStart: child.startPosition.row + 1,
          lineEnd: child.endPosition.row + 1,
          kind: child.type,
        });
        if (spec.containerTypes.size > 0 && depth < 3) {
          visit(child, depth + 1);
        }
        continue;
      }
      if (depth < 4) {
        visit(child, depth + 1);
      }
    }
  };

  visit(tree.rootNode, 0);
  tree.delete?.();

  return defs;
}

function isDefinition(node: TsNode, spec: LangSpec, lang: string): boolean {
  if (lang === "elixir") {
    return node.type === "call" && elixirKeyword(node) !== null;
  }
  return spec.defTypes.has(node.type);
}
