import type {
  AgentToolResult,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { resolveScheduledTaskDefinition } from "./scheduler.js";
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskDelivery,
  ScheduledTaskType,
  TaskScheduler,
} from "./types.js";

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

function formatTaskSummary(task: ScheduledTask) {
  return {
    id: task.id,
    name: task.name,
    type: task.type,
    schedule: task.schedule,
    delivery: task.delivery,
    enabled: task.enabled,
    lastStatus: task.lastStatus ?? "pending",
    nextRunAt: task.nextRunAt,
    runCount: task.runCount,
    prompt: task.prompt.length > 100 ? `${task.prompt.slice(0, 100)}…` : task.prompt,
  };
}

const taskTypeSchema = Type.Union([
  Type.Literal("cron"),
  Type.Literal("once"),
  Type.Literal("interval"),
]);

const deliverySchema = Type.Union([
  Type.Literal("new-session"),
  Type.Literal("origin-session"),
]);

const PROMPT_GUIDELINES = [
  "Use scheduler_create when the user asks for something to run later, repeatedly, or at a specific time of day — phrase the schedule as a cron expression, a relative delay like +10m, or an interval like 1h.",
  "scheduler_create requires a delivery mode: use new-session to run the prompt in a fresh autonomous headless pi session, or origin-session to append it to the current session when it fires.",
  "Prompts for scheduled tasks must be fully self-contained: they run non-interactively later, so include all context, file paths, and acceptance criteria in the prompt itself.",
  "Use scheduler_list to show the user their scheduled tasks and scheduler_run_now to trigger one immediately for testing.",
  "When the user schedules a task, confirm the parsed schedule, next run time, and delivery mode back to them.",
];

export function createSchedulerTools(scheduler: TaskScheduler): ToolDefinition[] {
  return [
    {
      name: "scheduler_create",
      label: "Scheduler",
      description:
        "Schedule a prompt to be executed automatically at a future time or on a recurring basis. Supports cron expressions (e.g. \"0 9 * * 1-5\"), one-time schedules (ISO timestamp or relative like \"+10m\"), and fixed intervals (\"30s\", \"5m\", \"1h\"). The prompt runs non-interactively: delivery \"new-session\" spawns a fresh headless pi session, \"origin-session\" appends the prompt to the session it was scheduled from. Use this whenever the user wants something to happen later, repeatedly, or on a timer.",
      promptSnippet:
        "Schedule prompts to run automatically later via cron, one-time delay, or fixed interval, delivered as headless pi sessions",
      promptGuidelines: PROMPT_GUIDELINES,
      parameters: Type.Object({
        type: taskTypeSchema,
        schedule: Type.String({
          description:
            "Schedule expression. Cron: \"0 9 * * 1-5\"; Once: ISO timestamp or \"+10m\"; Interval: \"30s\", \"5m\", \"1h\".",
        }),
        prompt: Type.String({
          description:
            "The prompt to execute when triggered. Must be self-contained because it runs non-interactively.",
        }),
        delivery: deliverySchema,
        name: Type.Optional(
          Type.String({ description: "Human-readable name for this scheduled task." }),
        ),
        enabled: Type.Optional(
          Type.Boolean({ description: "Whether the task is enabled. Default true." }),
        ),
        timeoutMs: Type.Optional(
          Type.Number({
            description: "Maximum execution time in milliseconds. Defaults to 30 minutes.",
          }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: ExtensionContext,
      ): Promise<AgentToolResult<unknown>> {
        try {
          const definition = resolveScheduledTaskDefinition({
            type: params.type as ScheduledTaskType,
            schedule: params.schedule as string,
          });
          const input: ScheduledTaskCreateInput = {
            ...definition,
            prompt: params.prompt as string,
            delivery: params.delivery as ScheduledTaskDelivery,
            cwd: ctx.cwd,
            enabled: params.enabled !== false,
            ...(params.name ? { name: params.name as string } : {}),
            ...(typeof params.timeoutMs === "number"
              ? { timeoutMs: params.timeoutMs as number }
              : {}),
          };
          if (input.delivery === "origin-session") {
            input.originSessionId = ctx.sessionManager.getSessionId();
          }
          const task = await scheduler.create(input);
          return textResult(JSON.stringify(formatTaskSummary(task), null, 2));
        } catch (error) {
          return textResult(
            `Failed to create task: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
    {
      name: "scheduler_list",
      label: "Scheduler",
      description: "List all scheduled tasks with their status and next run time.",
      promptSnippet: "List all scheduled tasks.",
      parameters: Type.Object({}),
      async execute(): Promise<AgentToolResult<unknown>> {
        const tasks = await scheduler.list();
        if (tasks.length === 0) {
          return textResult("No scheduled tasks.");
        }
        return textResult(JSON.stringify(tasks.map(formatTaskSummary), null, 2));
      },
    },
    {
      name: "scheduler_get",
      label: "Scheduler",
      description:
        "Get detailed information about a scheduled task, including its schedule, delivery mode, and run history.",
      parameters: Type.Object({
        taskId: Type.String({ description: "The scheduled-task ID to query." }),
      }),
      async execute(
        _toolCallId: string,
        params: Record<string, unknown>,
      ): Promise<AgentToolResult<unknown>> {
        const task = await scheduler.get(params.taskId as string);
        if (!task) {
          return textResult(`Task not found: ${params.taskId}`);
        }
        return textResult(JSON.stringify(task, null, 2));
      },
    },
    {
      name: "scheduler_update",
      label: "Scheduler",
      description:
        "Update a scheduled task. Can change schedule, prompt text, name, delivery mode, or enable/disable it.",
      parameters: Type.Object({
        taskId: Type.String({ description: "The scheduled-task ID to update." }),
        type: Type.Optional(taskTypeSchema),
        schedule: Type.Optional(Type.String({ description: "New schedule expression." })),
        prompt: Type.Optional(Type.String({ description: "New prompt." })),
        name: Type.Optional(Type.String({ description: "New name." })),
        delivery: Type.Optional(deliverySchema),
        enabled: Type.Optional(Type.Boolean({ description: "Enable or disable." })),
      }),
      async execute(
        _toolCallId: string,
        params: Record<string, unknown>,
      ): Promise<AgentToolResult<unknown>> {
        const { taskId, type, schedule, ...rest } = params as {
          taskId: string;
          type?: string;
          schedule?: string;
          [key: string]: unknown;
        };
        const update: Record<string, unknown> = { ...rest };
        if (type !== undefined || schedule !== undefined) {
          try {
            const existing = await scheduler.get(taskId);
            if (!existing) {
              return textResult(`Task not found: ${taskId}`);
            }
            const definition = resolveScheduledTaskDefinition({
              type: (type ?? existing.type) as ScheduledTaskType,
              schedule: schedule ?? existing.schedule,
            });
            Object.assign(update, definition);
          } catch (error) {
            return textResult(
              `Invalid schedule: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        const task = await scheduler.update(taskId, update);
        if (!task) {
          return textResult(`Task not found: ${taskId}`);
        }
        return textResult(JSON.stringify(formatTaskSummary(task), null, 2));
      },
    },
    {
      name: "scheduler_delete",
      label: "Scheduler",
      description: "Delete a scheduled task.",
      parameters: Type.Object({
        taskId: Type.String({ description: "The scheduled-task ID to delete." }),
      }),
      async execute(
        _toolCallId: string,
        params: Record<string, unknown>,
      ): Promise<AgentToolResult<unknown>> {
        const taskId = params.taskId as string;
        const deleted = await scheduler.delete(taskId);
        return textResult(deleted ? `Deleted task: ${taskId}` : `Task not found: ${taskId}`);
      },
    },
    {
      name: "scheduler_run_now",
      label: "Scheduler",
      description: "Trigger immediate execution of a scheduled task, ignoring its schedule.",
      parameters: Type.Object({
        taskId: Type.String({ description: "The scheduled-task ID to run immediately." }),
      }),
      async execute(
        _toolCallId: string,
        params: Record<string, unknown>,
      ): Promise<AgentToolResult<unknown>> {
        const taskId = params.taskId as string;
        const task = await scheduler.runNow(taskId);
        if (!task) {
          return textResult(`Task not found: ${taskId}`);
        }
        return textResult(`Triggered: ${task.name ?? task.id}`);
      },
    },
  ];
}
