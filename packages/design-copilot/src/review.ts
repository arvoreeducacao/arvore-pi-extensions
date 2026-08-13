import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveReviewProtocol } from "./ds.js";
import { UI_FILE_RE } from "./shared.js";

const SHELL_TOOLS = new Set(["bash", "shell"]);
const PR_CREATE_RE = /\bgh\s+pr\s+create\b/;
const IGNORED_FILE_RE = /(\/__tests__\/|\.(test|spec|stories)\.)/;
const REPOS_WITH_DESIGN_SYSTEM = ["frontend-arvore-nextjs", "superautor-sistema"];

function reviewPrompt(protocolPath: string): string {
  return `[DESIGN REVIEW]
Leia ${protocolPath} e execute exatamente o que ele diz. Prefira delegar a um sub-agent de contexto fresco (tool subagent, context: "fresh") para não poluir este contexto; se não houver subagent disponível, faça você mesmo.

Não improvise processo próprio, não leia os guidelines.md inteiros e não produza relatório de conformidade. O protocolo define o roteamento entre os design systems, o que ler, como olhar a tela, o teto de achados e o formato da saída — inclusive o caso em que a saída correta é dizer que não há nada a apontar.`;
}

const PROTOCOL_MISSING = `[DESIGN REVIEW]
Não encontrei design/design-review.md subindo a partir deste diretório. O protocolo do review mora no arvore-hub — atualize o repo (git pull) e rode /design-review de novo. Não tente reconstruir o protocolo de memória.`;

function cwdOf(ctx: ExtensionContext): string {
  return (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd();
}

function reviewMessage(ctx: ExtensionContext): string {
  const protocolPath = resolveReviewProtocol(cwdOf(ctx));
  return protocolPath ? reviewPrompt(protocolPath) : PROTOCOL_MISSING;
}

function repoRootFor(cwd: string): { dir: string; name: string } | null {
  for (const name of REPOS_WITH_DESIGN_SYSTEM) {
    const marker = `/${name}`;
    const index = cwd.indexOf(marker);
    if (index !== -1) {
      return { dir: cwd.slice(0, index + marker.length), name };
    }
  }
  return null;
}

function changedUiFiles(cwd: string): string[] {
  const repo = repoRootFor(cwd);
  if (!repo || !existsSync(join(repo.dir, ".git"))) return [];
  for (const range of ["origin/main...HEAD", "HEAD"]) {
    try {
      const out = execFileSync("git", ["diff", "--name-only", range], {
        cwd: repo.dir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const files = out
        .split("\n")
        .filter(Boolean)
        .filter((f) => UI_FILE_RE.test(f) && !IGNORED_FILE_RE.test(f));
      if (files.length > 0) return files;
    } catch {
      continue;
    }
  }
  return [];
}

export function registerReviewGate(pi: ExtensionAPI): void {
  let askedThisSession = false;

  pi.registerCommand("design-review", {
    description:
      "Olhar a tela alterada e devolver no máximo 3 achados — ou nada, quando não há o que apontar",
    handler: async (_args, ctx: ExtensionContext) => {
      pi.sendMessage(
        { customType: "design-review-request", content: reviewMessage(ctx), display: true },
        { triggerTurn: true },
      );
      ctx.ui.notify("Rodando design review…", "info");
    },
  });

  pi.on("tool_call", async (event) => {
    if (askedThisSession) return;
    if (!SHELL_TOOLS.has(event.toolName)) return;
    const command = (event.input as { command?: string } | undefined)?.command ?? "";
    if (!PR_CREATE_RE.test(command)) return;

    const files = changedUiFiles(process.cwd());
    if (files.length === 0) return;

    askedThisSession = true;
    const shown = files.slice(0, 10);
    return {
      block: true,
      reason: [
        `[DESIGN] Este PR toca ${files.length} arquivo(s) de UI:`,
        ...shown.map((f) => `  - ${f}`),
        files.length > shown.length ? `  (+${files.length - shown.length} outros)` : "",
        "",
        "PERGUNTE ao usuário, em uma linha, se ele quer um design review antes de abrir o PR — e respeite a resposta. Não rode o review sem perguntar.",
        "",
        "  sim → rode /design-review, aplique o que fizer sentido, depois reexecute o `gh pr create`.",
        "  não → apenas reexecute o `gh pr create`.",
        "",
        "Este aviso não se repete nesta sessão.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });

  pi.on("session_start", async () => {
    askedThisSession = false;
  });
}
