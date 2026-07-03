import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const REVIEW_PROMPT = `[DESIGN REVIEW — GATE DE HEURÍSTICAS]
Faça uma auditoria da UI que acabou de ser criada/alterada nesta sessão contra o design system da Árvore. Prefira delegar a um sub-agent de contexto fresco (tool subagent, context: "fresh") para não poluir este contexto; se não houver subagent disponível, faça você mesmo.

O revisor DEVE ler, nesta ordem:
1. design/design-system/guidelines.md (§8 é o gate de aceitação: tokens, shadcn-first, tipografia, layout responsivo, estados, heurísticas, acessibilidade)
2. design/design-system/foundations/usability-heuristics.md (10 heurísticas de Nielsen + UX infantil se a tela for para criança)

Depois, para cada arquivo de UI alterado no diff atual, reporte findings agrupados por eixo:
- Tokens & cores: usa tokens do Bonsai? algum valor hardcoded?
- Componente: shadcn-first? reusou componente existente em vez de recriar?
- Ícones/emojis: usa @/components/icons (find_icon)? algum emoji proibido? algum lucide-react?
- Tipografia, spacing, elevação, borders: dentro das foundations?
- Responsividade: cobre mobile/tablet/desktop conforme o brief?
- Estados: loading, empty, error, success cobertos?
- Acessibilidade (WCAG AA): contraste, aria-label em ícones interativos, foco, semântica?
- 10 heurísticas de Nielsen: aponte violações concretas (não genéricas).
- UX infantil (se aplicável): alvos grandes, linguagem simples, feedback claro?

Formato do resultado: lista de findings priorizados (🔴 bloqueia / 🟡 ajustar / 🟢 ok), cada um com arquivo:linha e a correção sugerida. Termine com um veredito: APROVADO ou AJUSTES NECESSÁRIOS.`;

export function registerReviewGate(pi: ExtensionAPI): void {
  let uiTouchedThisSession = false;

  pi.registerCommand("design-review", {
    description: "Auditar a UI gerada contra o design system e as 10 heurísticas (guidelines §8)",
    handler: async (_args, ctx: ExtensionContext) => {
      pi.sendMessage(
        { customType: "design-review-request", content: REVIEW_PROMPT, display: true },
        { triggerTurn: true },
      );
      ctx.ui.notify("Rodando design review contra o design system…", "info");
    },
  });

  pi.on("tool_call", async (event) => {
    if ((event.toolName === "edit" || event.toolName === "write")) {
      const path = (event.input as { path?: string } | undefined)?.path;
      if (path && /\.(tsx|jsx|css|scss|vue)$/i.test(path)) {
        uiTouchedThisSession = true;
      }
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!uiTouchedThisSession || !ctx.hasUI) return;
    uiTouchedThisSession = false;
    const choice = await ctx.ui.select(
      "Você alterou UI nesta sessão. Rodar o gate de heurísticas (design review) agora?",
      ["Sim, rodar /design-review", "Não, pular"],
    );
    if (choice?.startsWith("Sim")) {
      pi.sendMessage(
        { customType: "design-review-request", content: REVIEW_PROMPT, display: true },
        { triggerTurn: true },
      );
    }
  });
}
