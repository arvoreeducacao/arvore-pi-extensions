import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type DesignSystem = "bonsai" | "superautor";

interface DsPaths {
  label: string;
  root: string;
  assetsDir: string;
  assetsManifestRel: string;
  iconsManifestRel: string;
  iconsEnv: string;
  assetsEnv: string;
}

const DS: Record<DesignSystem, DsPaths> = {
  bonsai: {
    label: "Bonsai (Árvore)",
    root: "design/design-system",
    assetsDir: "design/design-system/assets",
    assetsManifestRel: "design/design-system/assets/assets.manifest.json",
    iconsManifestRel: "design/design-system/icons.manifest.json",
    iconsEnv: "ARVORE_ICONS_MANIFEST",
    assetsEnv: "ARVORE_ASSETS_MANIFEST",
  },
  superautor: {
    label: "SuperAutor",
    root: "design/superautor-design-system",
    assetsDir: "design/superautor-design-system/assets",
    assetsManifestRel: "design/superautor-design-system/assets/assets.manifest.json",
    iconsManifestRel: "design/superautor-design-system/icons.manifest.json",
    iconsEnv: "SUPERAUTOR_ICONS_MANIFEST",
    assetsEnv: "SUPERAUTOR_ASSETS_MANIFEST",
  },
};

const REVIEW_PROTOCOL_REL = "design/design-review.md";

export function dsConfig(ds: DesignSystem): DsPaths {
  return DS[ds];
}

export function dsForPath(path: string): DesignSystem {
  return /(^|\/)writing\//.test(path) || /superautor-sistema\//.test(path)
    ? "superautor"
    : "bonsai";
}

export function resolveReviewProtocol(cwd: string): string | null {
  return walkUp(cwd, REVIEW_PROTOCOL_REL);
}

function walkUp(cwd: string, rel: string): string | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveIconsManifest(ds: DesignSystem, cwd: string): string | null {
  const cfg = DS[ds];
  const override = process.env[cfg.iconsEnv];
  if (override && existsSync(override)) return override;
  return walkUp(cwd, cfg.iconsManifestRel);
}

export function resolveAssetsManifest(
  ds: DesignSystem,
  cwd: string,
): { manifestPath: string; assetsDir: string } | null {
  const cfg = DS[ds];
  const override = process.env[cfg.assetsEnv];
  if (override && existsSync(override)) {
    return { manifestPath: override, assetsDir: resolve(override, "..") };
  }
  const manifestPath = walkUp(cwd, cfg.assetsManifestRel);
  if (!manifestPath) return null;
  return { manifestPath, assetsDir: resolve(manifestPath, "..") };
}
