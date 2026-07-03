import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { UI_FILE_RE } from "./shared.js";

const UI_TOOLS = new Set(["edit", "write"]);

const BRIEF_INSTRUCTION = `[DESIGN COPILOT — BRIEF ANTES DE GERAR UI]
Antes de criar/alterar interface na Árvore, produza um design brief. NÃO faça um interrogatório: primeiro INFIRA do pedido tudo que der (ex: "tela pro estudante" já implica persona=estudante e provável UX infantil). Use ask_user_question SOMENTE para o que for genuinamente ambíguo e que mude a implementação.

Depois de inferir + resolver ambiguidades, chame a tool submit_design_brief com:
- persona: quem usa a tela (estudante/educador/decisor/família ou específico)
- childUx: true se crianças usam (aplica heurísticas de UX infantil)
- responsiveTargets: alvos (ex: "mobile+tablet+desktop" ou "só mobile")
- statesCovered: quais estados a UI cobre (loading/empty/error/success)
- assetsNeeded: precisa de ícones/ilustrações? (se sim, você usará find_icon/find_asset)
- inferred: o que você inferiu sem perguntar (para transparência)

O gate só libera edit/write em .tsx/.jsx/.css/.scss depois que submit_design_brief for aceita. Escape manual: /skip-brief.`;

interface BriefState {
  done: boolean;
  skipped: boolean;
  summary: string;
}

function initialBriefState(): BriefState {
  return { done: false, skipped: false, summary: "" };
}

interface SubmitBriefDetails {
  accepted: boolean;
  missing?: string[];
}

function pathFromInput(input: unknown): string | undefined {
  if (input && typeof input === "object" && "path" in input) {
    const p = (input as { path?: unknown }).path;
    if (typeof p === "string") return p;
  }
  return undefined;
}

export function registerBriefGate(pi: ExtensionAPI): void {
  let state: BriefState = initialBriefState();

  function updateStatus(ctx: ExtensionContext): void {
    if (state.done) {
      ctx.ui.setStatus("design-brief", ctx.ui.theme.fg("success", "🎨 brief ✓"));
    } else if (state.skipped) {
      ctx.ui.setStatus("design-brief", ctx.ui.theme.fg("dim", "🎨 brief skipped"));
    } else {
      ctx.ui.setStatus("design-brief", ctx.ui.theme.fg("warning", "🎨 no brief"));
    }
  }

  pi.registerTool({
    name: "submit_design_brief",
    label: "Submit Design Brief",
    description:
      "Register the design brief for the UI you are about to build and unlock UI edits. Infer what you can from the user's request and only ask the user (via ask_user_question) about genuinely ambiguous points before calling this. The brief is validated: persona, responsiveTargets and statesCovered are required.",
    promptSnippet:
      "submit_design_brief — register the (mostly inferred) design brief to unlock UI editing.",
    promptGuidelines: [
      "Before generating or editing any Árvore UI, infer a design brief from the request, ask the user only about genuinely ambiguous points, then call submit_design_brief. Do not interrogate the user about things already implied by the request.",
    ],
    parameters: Type.Object({
      persona: Type.String({
        description: "Quem usa a tela (estudante/educador/decisor/família ou perfil específico).",
      }),
      childUx: Type.Boolean({
        description: "true se crianças usam a tela (aplica heurísticas de UX infantil).",
      }),
      responsiveTargets: Type.String({
        description: "Alvos responsivos, ex: 'mobile+tablet+desktop' ou 'só mobile'.",
      }),
      statesCovered: Type.Array(Type.String(), {
        description: "Estados que a UI vai cobrir: loading, empty, error, success.",
      }),
      assetsNeeded: Type.Boolean({
        description: "true se a tela precisa de ícones/ilustrações (usar find_icon/find_asset).",
      }),
      inferred: Type.Optional(
        Type.String({ description: "O que você inferiu sem perguntar, para transparência." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const missing: string[] = [];
      if (!params.persona || !String(params.persona).trim()) missing.push("persona");
      if (!params.responsiveTargets || !String(params.responsiveTargets).trim()) {
        missing.push("responsiveTargets");
      }
      if (!Array.isArray(params.statesCovered) || params.statesCovered.length === 0) {
        missing.push("statesCovered");
      }

      if (missing.length > 0) {
        const details: SubmitBriefDetails = { accepted: false, missing };
        return {
          content: [
            {
              type: "text",
              text: `Design brief incompleto. Faltam: ${missing.join(", ")}. Infira ou pergunte ao usuário e chame submit_design_brief novamente. O gate de UI segue bloqueado.`,
            },
          ],
          details,
        };
      }

      state.summary = [
        `Persona: ${params.persona}`,
        `UX infantil: ${params.childUx ? "sim" : "não"}`,
        `Responsivo: ${params.responsiveTargets}`,
        `Estados: ${params.statesCovered.join(", ")}`,
        `Precisa de ícones/ilustrações: ${params.assetsNeeded ? "sim (usar find_icon/find_asset)" : "não"}`,
        params.inferred ? `Inferido: ${params.inferred}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      state.done = true;
      state.skipped = false;
      updateStatus(ctx);

      const details: SubmitBriefDetails = { accepted: true };
      return {
        content: [
          {
            type: "text",
            text: `Design brief aceito. UI liberada.\n${state.summary}\n\nSiga a skill bonsai-design-system e as 10 heurísticas de Nielsen${
              params.childUx ? " + UX infantil" : ""
            }. Use find_icon para ícones e find_asset para ilustrações. Ao final, rode /design-review antes de considerar a tela pronta.`,
          },
        ],
        details,
      };
    },
  });

  pi.registerCommand("design-brief", {
    description: "Disparar o design brief (o modelo infere o contexto e pergunta só o ambíguo)",
    handler: async (_args, ctx) => {
      pi.sendMessage(
        { customType: "design-brief-trigger", content: BRIEF_INSTRUCTION, display: true },
        { triggerTurn: true },
      );
      ctx.ui.notify("Montando o design brief…", "info");
    },
  });

  pi.registerCommand("skip-brief", {
    description: "Pular o design brief e liberar edição de UI nesta sessão (escape do gate)",
    handler: async (_args, ctx) => {
      state.skipped = true;
      state.done = false;
      updateStatus(ctx);
      ctx.ui.notify("Design brief pulado. Gate de UI liberado nesta sessão.", "warning");
    },
  });

  pi.on("tool_call", async (event) => {
    if (state.done || state.skipped) return;
    if (!UI_TOOLS.has(event.toolName)) return;
    const path = pathFromInput(event.input);
    if (!path || !UI_FILE_RE.test(path)) return;

    return {
      block: true,
      reason: `Design gate: alteração de UI (${path}) bloqueada porque o design brief não foi registrado.\nInfira um design brief do pedido, pergunte ao usuário apenas o que for ambíguo e chame a tool submit_design_brief — ou use /skip-brief para pular nesta sessão.`,
    };
  });

  pi.on("before_agent_start", async () => {
    if (state.done || state.skipped) return;
    return {
      message: { customType: "design-copilot-guideline", content: BRIEF_INSTRUCTION, display: false },
    };
  });

  pi.on("context", async (event) => {
    return {
      messages: event.messages.filter((m) => {
        const msg = m as AgentMessage & { customType?: string };
        return msg.customType !== "design-copilot-guideline";
      }),
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    state = initialBriefState();
    updateStatus(ctx);
  });
}
