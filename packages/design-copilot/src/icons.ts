import { readFileSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type DesignSystem, dsConfig, resolveIconsManifest } from "./ds.js";

interface IconEntry {
  name: string;
  file: string;
  keywords: string[];
}

interface IconManifest {
  count: number;
  importPath: string;
  usage?: string;
  icons: IconEntry[];
}

interface FindIconDetails {
  error?: string;
  count?: number;
  top?: string;
}

const cache: Partial<Record<DesignSystem, IconManifest>> = {};

function loadManifest(ds: DesignSystem, cwd: string): IconManifest | null {
  if (cache[ds]) return cache[ds] ?? null;
  const path = resolveIconsManifest(ds, cwd);
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as IconManifest;
    cache[ds] = parsed;
    return parsed;
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
    label: "Find Icon",
    description:
      "Search a design system's icon set by concept in PT or EN and get the exact icon name + ready-to-use usage snippet. designSystem is REQUIRED: 'bonsai' = Árvore/Bonsai React icons (frontend-arvore-nextjs), 'superautor' = SuperAutor Rails SVG icons (superautor-sistema). ALWAYS use this to pick an icon instead of guessing a name or using lucide-react/react-icons. NEVER mix icons across design systems.",
    promptSnippet:
      "find_icon — search a design system's icon set (designSystem: 'bonsai' | 'superautor') and get the exact name + usage snippet.",
    promptGuidelines: [
      "When you need an icon, call find_icon with the correct designSystem for the project you are in ('bonsai' for Árvore/frontend-arvore-nextjs, 'superautor' for SuperAutor/superautor-sistema) and use one of the returned icons — never guess a name and never import lucide-react or react-icons.",
      "Never mix design systems: a Bonsai screen uses only bonsai icons, a SuperAutor screen uses only superautor icons. Never use emojis in generated UI; use a system icon instead.",
    ],
    parameters: Type.Object({
      designSystem: Type.Union([Type.Literal("bonsai"), Type.Literal("superautor")], {
        description:
          "Which design system's icons to search. 'bonsai' = Árvore (React, @/components/icons). 'superautor' = SuperAutor (Rails SVG, icones/). REQUIRED.",
      }),
      concept: Type.String({
        description: "What the icon should represent, in PT or EN (e.g. 'adicionar aluno', 'trash', 'livro').",
      }),
      limit: Type.Optional(
        Type.Number({ description: "Max results to return (default 8)." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd();
      const ds = params.designSystem as DesignSystem;
      const cfg = dsConfig(ds);
      const manifest = loadManifest(ds, cwd);
      if (!manifest) {
        const details: FindIconDetails = { error: "manifest_missing" };
        return {
          content: [
            {
              type: "text",
              text: `Icon manifest for ${cfg.label} not found. Set ${cfg.iconsEnv} to the icons.manifest.json path, or run from a workspace that contains ${cfg.iconsManifestRel} (generated in arvore-hub).`,
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
      const list = ranked
        .map((r) => `- ${r.icon.name}  (file: ${r.icon.file})`)
        .join("\n");

      let usage: string;
      if (ds === "superautor") {
        const use = manifest.usage ?? "Rails: <%= render_svg 'icones/<file>' %>";
        usage = `Uso (${cfg.label}): ${use}\nEx: <%= render_svg '${manifest.importPath}${ranked[0].icon.file}' %>`;
      } else {
        const importLine = `import { ${names.join(", ")} } from '${manifest.importPath}'`;
        usage = `Import:\n${importLine}\n\nUsage: <${names[0]} className="size-5" />`;
      }

      const details: FindIconDetails = { count: ranked.length, top: names[0] };
      return {
        content: [
          {
            type: "text",
            text: `Matches for "${params.concept}" in ${cfg.label}:\n${list}\n\n${usage}`,
          },
        ],
        details,
      };
    },
  });
}
