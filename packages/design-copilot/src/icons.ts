import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface IconEntry {
  name: string;
  file: string;
  keywords: string[];
}

interface IconManifest {
  count: number;
  importPath: string;
  icons: IconEntry[];
}

interface FindIconDetails {
  error?: string;
  count?: number;
  top?: string;
}

let cache: IconManifest | null = null;

function loadManifest(): IconManifest | null {
  if (cache) return cache;
  try {
    const raw = readFileSync(join(__dirname, "..", "data", "icons.manifest.json"), "utf-8");
    cache = JSON.parse(raw) as IconManifest;
    return cache;
  } catch {
    return null;
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function scoreIcon(icon: IconEntry, terms: string[]): number {
  let score = 0;
  const kws = icon.keywords.map(normalize);
  const fileNorm = normalize(icon.file);
  for (const term of terms) {
    if (kws.includes(term)) {
      score += 10;
      continue;
    }
    if (fileNorm === term) {
      score += 10;
      continue;
    }
    if (kws.some((k) => k.startsWith(term) || term.startsWith(k))) {
      score += 4;
      continue;
    }
    if (kws.some((k) => k.includes(term))) {
      score += 2;
    }
  }
  if (score > 0 && fileNorm.length <= 8) score += 1;
  return score;
}

export function registerIconTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "find_icon",
    label: "Find Bonsai Icon",
    description:
      "Search the Árvore custom icon set (~966 icons in frontend-arvore-nextjs/src/components/icons) by concept in PT or EN. Returns the matching icon component names and a ready-to-paste import. ALWAYS use this to pick an icon instead of guessing a name or using lucide-react/react-icons.",
    promptSnippet:
      "find_icon — search the Árvore custom icon set by concept and get the exact component name + import line.",
    promptGuidelines: [
      "When you need an icon in any Árvore frontend, call find_icon with the concept (e.g. 'delete', 'aluno', 'livro') and use one of the returned components — never guess an icon name and never import lucide-react or react-icons.",
      "Icons come from '@/components/icons'. Never use emojis in generated UI; use a system icon instead.",
    ],
    parameters: Type.Object({
      concept: Type.String({
        description: "What the icon should represent, in PT or EN (e.g. 'adicionar aluno', 'trash', 'livro').",
      }),
      limit: Type.Optional(
        Type.Number({ description: "Max results to return (default 8)." }),
      ),
    }),
    async execute(_toolCallId, params) {
      const manifest = loadManifest();
      if (!manifest) {
        const details: FindIconDetails = { error: "manifest_missing" };
        return {
          content: [
            {
              type: "text",
              text: "Icon manifest not found. Run `pnpm --filter @arvoretech/pi-design-copilot gen:icons` to generate data/icons.manifest.json.",
            },
          ],
          details,
        };
      }

      const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : 8;
      const terms = normalize(String(params.concept))
        .split(/\s+/)
        .filter(Boolean);

      if (terms.length === 0) {
        const details: FindIconDetails = { error: "empty_concept" };
        return {
          content: [{ type: "text", text: "Provide a non-empty concept to search for." }],
          details,
        };
      }

      const ranked = manifest.icons
        .map((icon) => ({ icon, score: scoreIcon(icon, terms) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.icon.file.localeCompare(b.icon.file))
        .slice(0, limit);

      if (ranked.length === 0) {
        const details: FindIconDetails = { count: 0 };
        return {
          content: [
            {
              type: "text",
              text: `No icon matched "${params.concept}". Try a simpler term (PT or EN). Total icons available: ${manifest.count}.`,
            },
          ],
          details,
        };
      }

      const names = ranked.map((r) => r.icon.name);
      const importLine = `import { ${names.join(", ")} } from '${manifest.importPath}'`;
      const list = ranked
        .map((r) => `- ${r.icon.name}  (file: ${r.icon.file})`)
        .join("\n");

      const details: FindIconDetails = { count: ranked.length, top: names[0] };
      return {
        content: [
          {
            type: "text",
            text: `Matches for "${params.concept}":\n${list}\n\nImport:\n${importLine}\n\nUsage: <${names[0]} className="size-5" />`,
          },
        ],
        details,
      };
    },
  });
}
