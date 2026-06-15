import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
	buildWarpUri,
	extractPlanSection,
	extractPlanTitle,
	extractTodoItems,
	isInsideWarp,
	isSafeCommand,
	looksComplex,
	markCompletedSteps,
	slugify,
	type TodoItem,
} from "./utils.js";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const MUTATING_TOOLS = new Set(["edit", "write"]);

const PLAN_INSTRUCTIONS = `[PLAN MODE ATIVO]
Você está em plan mode — modo somente-leitura para análise e refinamento antes de codar. Esta é uma plataforma de educação (edtech), então o contexto de negócio e pedagógico importa tanto quanto o técnico.

Restrições (impostas por hard gate, não apenas instrução):
- Você só pode usar: read, bash, grep, find, ls, questionnaire
- edit e write estão BLOQUEADOS — qualquer tentativa é rejeitada pelo gate
- bash está restrito a um allowlist de comandos somente-leitura

Antes de planejar, ENTENDA o problema por completo. Faça perguntas de esclarecimento usando a tool questionnaire, cobrindo:

Negócio e produto:
- Qual problema concreto e mensurável estamos resolvendo? O que acontece hoje que mostra que ele existe?
- Qual o impacto de não fazer nada? Qual a prioridade?
- O que está dentro do escopo agora e o que fica explicitamente de fora?

Usuários e pedagogia:
- Quem é diretamente impactado: aluno, professor, escola, coordenação, editora?
- Há variação por perfil, plano, série/ano, ou tipo de conteúdo?
- Há implicação pedagógica (avaliação, leitura, fluência, antifraude) que precisa ser respeitada?

Técnico:
- Quais repositórios e sistemas são afetados?
- Quais alternativas estamos descartando e por quê?
- Happy path, erros, falhas de rede, timeouts, escala esperada e máxima?
- Padrões de UX, código, arquitetura e acessibilidade a seguir?

Sempre que fizer uma pergunta com alternativas, ofereça opções claras para o usuário escolher (não peça texto livre quando opções resolvem). Pesquise o codebase com read/grep/find para basear tudo em fatos, não suposições.

Quando tiver contexto suficiente, produza um plano detalhado e numerado sob um header "Plan:":

# Título curto do plano

Plan:
1. Primeiro passo
2. Segundo passo
...

NÃO tente fazer mudanças — apenas descreva o que faria. O usuário aprova com /build.`;

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let lastPlanText = "";
	let lastShownPlan = "";
	let lastPlanFile: string | undefined;
	let suggestedThisSession = false;

	pi.registerFlag("plan", {
		description: "Iniciar em plan mode (exploração somente-leitura)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan (locked)"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text));
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function enablePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = true;
		executionMode = false;
		todoItems = [];
		lastPlanText = "";
		lastShownPlan = "";
		pi.setActiveTools(PLAN_MODE_TOOLS);
		ctx.ui.notify(`Plan mode ativado (locked). Tools: ${PLAN_MODE_TOOLS.join(", ")}. Aprove com /build.`, "info");
		updateStatus(ctx);
	}

	function disablePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = false;
		pi.setActiveTools(NORMAL_MODE_TOOLS);
		ctx.ui.notify("Plan mode desativado. Acesso total restaurado.", "info");
		updateStatus(ctx);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			disablePlanMode(ctx);
		} else {
			enablePlanMode(ctx);
		}
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			planFile: lastPlanFile,
		});
	}

	function savePlanToFile(ctx: ExtensionContext, planText: string): string {
		const title = extractPlanTitle(planText);
		const date = new Date().toISOString().slice(0, 10);
		const slug = slugify(title) || "plano";
		const dir = join(ctx.cwd, ".pi", "plans");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `${date}-${slug}.md`);
		const body = `# ${title}\n\n_Gerado em ${new Date().toISOString()} via plan mode._\n\n${extractPlanSection(planText)}\n`;
		writeFileSync(file, body, "utf8");
		return file;
	}

	function openInEditor(filePath: string, cwd: string): boolean {
		if (isInsideWarp()) {
			spawn("open", [buildWarpUri(filePath)], { detached: true, stdio: "ignore", cwd }).unref();
			return true;
		}
		const editor = process.env.EDITOR;
		if (editor) {
			spawn(editor, [filePath], { detached: true, stdio: "ignore", cwd }).unref();
			return true;
		}
		return false;
	}

	pi.registerCommand("plan", {
		description: "Alternar plan mode (exploração somente-leitura, edits bloqueados)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("build", {
		description: "Aprovar o plano atual e executá-lo (sai do plan mode)",
		handler: async (_args, ctx) => {
			if (!planModeEnabled) {
				ctx.ui.notify("Não há plano pendente. Use /plan primeiro.", "warning");
				return;
			}
			if (todoItems.length === 0 && !lastPlanText) {
				ctx.ui.notify("Nenhum plano detectado ainda. Peça ao agente para gerar um plano sob 'Plan:'.", "warning");
				return;
			}

			if (lastPlanText) {
				lastPlanFile = savePlanToFile(ctx, lastPlanText);
				ctx.ui.notify(`Plano salvo em ${lastPlanFile}`, "info");
			}

			planModeEnabled = false;
			executionMode = todoItems.length > 0;
			pi.setActiveTools(NORMAL_MODE_TOOLS);
			updateStatus(ctx);
			persistState();

			const execMessage =
				todoItems.length > 0
					? `Plano aprovado. Execute em ordem, começando por: ${todoItems[0].text}\nApós concluir cada passo, inclua a tag [DONE:n] na resposta.`
					: "Plano aprovado. Execute o plano que você acabou de criar.";
			pi.sendMessage({ customType: "plan-mode-execute", content: execMessage, display: true }, { triggerTurn: true });
		},
	});

	pi.registerCommand("plan-open", {
		description: "Abrir o plano atual no editor (Warp/$EDITOR) para revisar e editar",
		handler: async (_args, ctx) => {
			if (!lastPlanFile) {
				if (lastPlanText) {
					lastPlanFile = savePlanToFile(ctx, lastPlanText);
				} else {
					ctx.ui.notify("Nenhum plano para abrir ainda. Gere um plano primeiro.", "warning");
					return;
				}
			}
			if (openInEditor(lastPlanFile, ctx.cwd)) {
				ctx.ui.notify(`Abrindo ${lastPlanFile} no editor.`, "info");
			} else {
				ctx.ui.notify(`Plano salvo em ${lastPlanFile} (sem editor detectado).`, "info");
			}
		},
	});

	pi.registerCommand("todos", {
		description: "Mostrar o progresso do plano atual",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("Sem todos. Crie um plano com /plan.", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Progresso do plano:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Alternar plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	pi.on("input", async (event, ctx) => {
		if (planModeEnabled || executionMode || suggestedThisSession || !ctx.hasUI) return;
		if (event.source !== "interactive") return;
		if (event.text.startsWith("/") || event.text.startsWith("!")) return;
		if (!looksComplex(event.text)) return;

		suggestedThisSession = true;
		const choice = await ctx.ui.select("Essa tarefa parece complexa. Quer planejar antes de codar?", [
			"Sim, entrar em plan mode (refinar antes de codar)",
			"Não, seguir direto",
		]);
		if (choice?.startsWith("Sim")) {
			enablePlanMode(ctx);
		}
	});

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return;

		if (MUTATING_TOOLS.has(event.toolName)) {
			return {
				block: true,
				reason: `Plan mode ativo: ${event.toolName} bloqueado. O plano precisa ser aprovado com /build antes de qualquer edição.`,
			};
		}

		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: comando bloqueado (não está no allowlist somente-leitura).\nComando: ${command}\nUse /plan para sair do plan mode ou /build para aprovar o plano.`,
				};
			}
		}
	});

	pi.on("context", async (event) => {
		if (planModeEnabled) return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;
				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ATIVO]");
				}
				if (Array.isArray(content)) {
					return !content.some((c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ATIVO]"));
				}
				return true;
			}),
		};
	});

	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: { customType: "plan-mode-context", content: PLAN_INSTRUCTIONS, display: false },
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTANDO PLANO — acesso total às tools]\n\nPassos restantes:\n${todoList}\n\nExecute cada passo em ordem. Após concluir um passo, inclua a tag [DONE:n] na resposta.`,
					display: false,
				},
			};
		}
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;
		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	pi.on("agent_end", async (event, ctx) => {
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plano concluído!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				lastPlanText = "";
				lastShownPlan = "";
				pi.setActiveTools(NORMAL_MODE_TOOLS);
				updateStatus(ctx);
				persistState();
			}
			return;
		}

		if (!planModeEnabled) return;

		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		let planChanged = false;
		if (lastAssistant) {
			const text = getTextContent(lastAssistant);
			const extracted = extractTodoItems(text);
			if (extracted.length > 0 && text !== lastPlanText) {
				todoItems = extracted;
				lastPlanText = text;
				planChanged = true;
			}
		}

		if (!planChanged || todoItems.length === 0 || lastPlanText === lastShownPlan || !ctx.hasUI) {
			return;
		}

		lastShownPlan = lastPlanText;
		lastPlanFile = savePlanToFile(ctx, lastPlanText);
		persistState();

		const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
		pi.sendMessage(
			{
				customType: "plan-todo-list",
				content: `**Plano (${todoItems.length} passos):**\n\n${todoListText}\n\nSalvo em \`${lastPlanFile}\`.\n_Use \`/plan-open\` para abrir no editor, \`/build\` para aprovar e executar, ou continue refinando._`,
				display: true,
			},
			{ triggerTurn: false },
		);
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as
			| { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean; planFile?: string } }
			| undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			lastPlanFile = planModeEntry.data.planFile ?? lastPlanFile;
		}

		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}
