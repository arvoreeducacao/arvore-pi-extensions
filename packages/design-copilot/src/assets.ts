import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface AssetEntry {
  id: string;
  nome: string;
  categoria: string;
  tags: string[];
  persona: string[];
  quando_usar: string;
  dimensoes: string | null;
  formato: string | null;
  licenca: string | null;
  path: string | null;
  source_url: string | null;
  status: string;
}

interface AssetManifest {
  assets: AssetEntry[];
}

interface FindAssetDetails {
  error?: string;
  count?: number;
  viewable?: number;
}

const MANIFEST_REL = "design/design-system/assets/assets.manifest.json";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function findManifest(cwd: string): { dir: string; manifest: AssetManifest } | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, MANIFEST_REL);
    if (existsSync(candidate)) {
      try {
        const manifest = JSON.parse(readFileSync(candidate, "utf-8")) as AssetManifest;
        return { dir: join(dir, "design/design-system/assets"), manifest };
      } catch {
        return null;
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function scoreAsset(asset: AssetEntry, terms: string[]): number {
  const haystack = [
    asset.id,
    asset.nome,
    asset.categoria,
    ...asset.tags,
    ...asset.persona,
    asset.quando_usar,
  ]
    .map(normalize)
    .join(" ");
  let score = 0;
  for (const term of terms) {
    if (asset.persona.map(normalize).includes(term)) score += 6;
    if (asset.tags.map(normalize).includes(term)) score += 5;
    if (normalize(asset.categoria) === term) score += 5;
    if (haystack.includes(term)) score += 2;
  }
  return score;
}

export function registerAssetTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "find_asset",
    label: "Find Brand Asset",
    description:
      "Search the Árvore curated brand/marketing asset registry (Otto mascot, illustrations, empty-state art, campaign assets). Returns the best matches with usage rules and, when a local thumbnail exists, its path so you can view it with the read tool before choosing. Use before adding any illustration or mascot to generated UI.",
    promptSnippet:
      "find_asset — search Árvore's curated brand asset registry (Otto, illustrations, empty states) with usage rules and viewable thumbnails.",
    promptGuidelines: [
      "Before adding any illustration, mascot (Otto), or campaign art to generated UI, call find_asset and reuse an existing asset instead of inventing new art.",
      "When a returned asset has a local `path`, read it with the read tool to actually see the image before using it. Respect the asset's `persona` and `quando_usar` rules.",
    ],
    parameters: Type.Object({
      intent: Type.String({
        description:
          "What you need the asset for, in PT or EN (e.g. 'empty state de aluno', 'celebração', 'otto onboarding').",
      }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 5)." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd();
      const found = findManifest(cwd);
      if (!found) {
        const details: FindAssetDetails = { error: "manifest_missing" };
        return {
          content: [
            {
              type: "text",
              text: `Asset manifest not found (looked for ${MANIFEST_REL} up the tree from ${cwd}). Make sure the arvore-hub design-system folder is present.`,
            },
          ],
          details,
        };
      }

      const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : 5;
      const terms = normalize(String(params.intent)).split(/\s+/).filter(Boolean);
      const ranked = found.manifest.assets
        .map((asset) => ({ asset, score: scoreAsset(asset, terms) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (ranked.length === 0) {
        const details: FindAssetDetails = { count: 0 };
        return {
          content: [
            {
              type: "text",
              text: `No asset matched "${params.intent}". Registry has ${found.manifest.assets.length} entries. You can add one via ${MANIFEST_REL}.`,
            },
          ],
          details,
        };
      }

      const blocks = ranked.map(({ asset }) => {
        const localPath = asset.path ? join(found.dir, asset.path) : null;
        const viewable = localPath && existsSync(localPath);
        const lines = [
          `• ${asset.nome} (id: ${asset.id})`,
          `  categoria: ${asset.categoria} | persona: ${asset.persona.join(", ") || "-"}`,
          `  quando usar: ${asset.quando_usar}`,
        ];
        if (viewable) {
          lines.push(`  thumbnail (leia com read para ver): ${localPath}`);
        } else if (asset.source_url) {
          lines.push(`  sem thumbnail local — fonte: ${asset.source_url} (status: ${asset.status})`);
        } else {
          lines.push(`  sem thumbnail local e sem source_url (status: ${asset.status})`);
        }
        return lines.join("\n");
      });

      const viewablePaths = ranked
        .map(({ asset }) => (asset.path ? join(found.dir, asset.path) : null))
        .filter((p): p is string => Boolean(p) && existsSync(p as string));

      const details: FindAssetDetails = { count: ranked.length, viewable: viewablePaths.length };
      return {
        content: [
          {
            type: "text",
            text: `Assets para "${params.intent}":\n\n${blocks.join("\n\n")}${
              viewablePaths.length
                ? `\n\nDica: leia estes paths com a tool read para ver as imagens antes de escolher.`
                : ""
            }`,
          },
        ],
        details,
      };
    },
  });
}
