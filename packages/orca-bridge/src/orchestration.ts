import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runOrca, isOrcaSession } from "./core.js";

function notInOrca() {
  return { content: [{ type: "text" as const, text: "Not running inside an Orca session." }], details: {} };
}

export function registerOrchestrationTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "orca_task_create",
    label: "Orca Task Create",
    description:
      "Create an Orca orchestration task. Tasks are units of work that can be dispatched to worker agents running in Orca terminals, with optional dependencies forming a DAG. Returns the task id.",
    promptSnippet: "Create an Orca orchestration task",
    promptGuidelines: [
      "Use Orca orchestration tools to coordinate multiple worker agents when running inside an Orca session: create tasks, dispatch them to terminals, and wait for results.",
      "Model dependencies with `deps` (array of task ids) so Orca only marks a task ready once its dependencies complete.",
    ],
    parameters: Type.Object({
      spec: Type.String({ description: "Full task specification / instructions for the worker" }),
      title: Type.Optional(Type.String({ description: "Concise task title" })),
      displayName: Type.Optional(Type.String({ description: "UI label for the dispatched worker row" })),
      deps: Type.Optional(Type.Array(Type.String(), { description: "Task ids this task depends on" })),
      parent: Type.Optional(Type.String({ description: "Parent task id" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["orchestration", "task-create", "--spec", params.spec];
      if (params.title) args.push("--task-title", params.title);
      if (params.displayName) args.push("--display-name", params.displayName);
      if (params.deps?.length) args.push("--deps", JSON.stringify(params.deps));
      if (params.parent) args.push("--parent", params.parent);
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `task-create failed: ${r.error}` }], details: {} };
      const taskId = r.result?.task?.id || r.result?.id;
      return { content: [{ type: "text", text: `Created task ${taskId}${params.title ? ` (${params.title})` : ""}` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_task_list",
    label: "Orca Task List",
    description: "List Orca orchestration tasks, optionally filtered by status or restricted to ready (unblocked) tasks.",
    promptSnippet: "List Orca orchestration tasks",
    parameters: Type.Object({
      status: Type.Optional(Type.String({ description: "Filter by status (e.g. pending, in_progress, completed)" })),
      ready: Type.Optional(Type.Boolean({ description: "Only tasks whose dependencies are satisfied" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["orchestration", "task-list"];
      if (params.status) args.push("--status", params.status);
      if (params.ready) args.push("--ready");
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `task-list failed: ${r.error}` }], details: {} };
      const tasks = r.result?.tasks || [];
      if (tasks.length === 0) return { content: [{ type: "text", text: "No tasks." }], details: { tasks: [] } };
      const lines = tasks.map((t: any) => `${t.id} [${t.status}] ${t.title || t.displayName || ""}`);
      return { content: [{ type: "text", text: lines.join("\n") }], details: { tasks } };
    },
  });

  pi.registerTool({
    name: "orca_task_update",
    label: "Orca Task Update",
    description: "Update the status of an Orca orchestration task, optionally attaching a JSON result payload.",
    promptSnippet: "Update an Orca task status",
    parameters: Type.Object({
      id: Type.String({ description: "Task id" }),
      status: Type.String({ description: "New status (e.g. in_progress, completed, blocked)" }),
      result: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Result payload attached to the task" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["orchestration", "task-update", "--id", params.id, "--status", params.status];
      if (params.result) args.push("--result", JSON.stringify(params.result));
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `task-update failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: `Task ${params.id} \u2192 ${params.status}` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_task_dispatch",
    label: "Orca Task Dispatch",
    description:
      "Dispatch an Orca task to a worker terminal (created with orca_terminal_start). Injects the task spec into the target agent. Returns dispatch context.",
    promptSnippet: "Dispatch an Orca task to a worker terminal",
    parameters: Type.Object({
      task: Type.String({ description: "Task id to dispatch" }),
      to: Type.String({ description: "Target terminal handle (the worker)" }),
      from: Type.Optional(Type.String({ description: "Sender terminal handle (the coordinator)" })),
      inject: Type.Optional(Type.Boolean({ description: "Inject the spec directly into the worker terminal input" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["orchestration", "dispatch", "--task", params.task, "--to", params.to];
      if (params.from) args.push("--from", params.from);
      if (params.inject) args.push("--inject");
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `dispatch failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: `Dispatched task ${params.task} to ${params.to}` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_msg_send",
    label: "Orca Message Send",
    description: "Send an inter-agent orchestration message to a worker/coordinator terminal.",
    promptSnippet: "Send an inter-agent Orca message",
    parameters: Type.Object({
      to: Type.String({ description: "Recipient terminal handle" }),
      subject: Type.String({ description: "Message subject" }),
      body: Type.Optional(Type.String({ description: "Message body" })),
      from: Type.Optional(Type.String({ description: "Sender terminal handle" })),
      type: Type.Optional(Type.String({ description: "Message type" })),
      priority: Type.Optional(Type.String({ description: "Priority level" })),
      threadId: Type.Optional(Type.String({ description: "Thread id to continue a conversation" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["orchestration", "send", "--to", params.to, "--subject", params.subject];
      if (params.body) args.push("--body", params.body);
      if (params.from) args.push("--from", params.from);
      if (params.type) args.push("--type", params.type);
      if (params.priority) args.push("--priority", params.priority);
      if (params.threadId) args.push("--thread-id", params.threadId);
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `send failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: `Message sent to ${params.to}` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_msg_check",
    label: "Orca Message Check",
    description:
      "Check orchestration messages for a terminal. By default returns unread messages and marks them read. Can optionally block until a message arrives.",
    promptSnippet: "Check Orca orchestration messages",
    parameters: Type.Object({
      terminal: Type.Optional(Type.String({ description: "Terminal handle to check (omit for active)" })),
      all: Type.Optional(Type.Boolean({ description: "Return all messages instead of only unread" })),
      types: Type.Optional(Type.Array(Type.String(), { description: "Filter by message types" })),
      wait: Type.Optional(Type.Boolean({ description: "Block until a message arrives" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Max wait when wait=true (default 60000)" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const timeout = params.timeoutMs ?? 60000;
      const args = ["orchestration", "check"];
      if (params.terminal) args.push("--terminal", params.terminal);
      if (params.all) args.push("--all");
      else args.push("--unread");
      if (params.types?.length) args.push("--types", params.types.join(","));
      if (params.wait) args.push("--wait", "--timeout-ms", String(timeout));
      const r = runOrca<any>(args, params.wait ? timeout + 5000 : 30000);
      if (!r.ok) return { content: [{ type: "text", text: `check failed: ${r.error}` }], details: {} };
      const msgs = r.result?.messages || [];
      if (msgs.length === 0) return { content: [{ type: "text", text: "No messages." }], details: { messages: [] } };
      const lines = msgs.map((m: any) => `[${m.id}] from ${m.from || "?"}: ${m.subject}${m.body ? ` \u2014 ${m.body}` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") }], details: { messages: msgs } };
    },
  });

  pi.registerTool({
    name: "orca_msg_reply",
    label: "Orca Message Reply",
    description: "Reply to an orchestration message by id.",
    promptSnippet: "Reply to an Orca orchestration message",
    parameters: Type.Object({
      id: Type.String({ description: "Message id to reply to" }),
      body: Type.String({ description: "Reply body" }),
      from: Type.Optional(Type.String({ description: "Sender terminal handle" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["orchestration", "reply", "--id", params.id, "--body", params.body];
      if (params.from) args.push("--from", params.from);
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `reply failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: `Replied to ${params.id}` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_gate_create",
    label: "Orca Gate Create",
    description:
      "Create a decision gate that blocks an Orca task until a human/coordinator resolves it. Use for approvals or branching decisions in an orchestration flow.",
    promptSnippet: "Create an Orca decision gate",
    parameters: Type.Object({
      task: Type.String({ description: "Task id the gate blocks" }),
      question: Type.String({ description: "Question presented at the gate" }),
      options: Type.Optional(Type.Array(Type.String(), { description: "Answer options" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["orchestration", "gate-create", "--task", params.task, "--question", params.question];
      if (params.options?.length) args.push("--options", JSON.stringify(params.options));
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `gate-create failed: ${r.error}` }], details: {} };
      const gateId = r.result?.gate?.id || r.result?.id;
      return { content: [{ type: "text", text: `Created gate ${gateId} on task ${params.task}` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_gate_resolve",
    label: "Orca Gate Resolve",
    description: "Resolve a pending Orca decision gate, unblocking its task.",
    promptSnippet: "Resolve an Orca decision gate",
    parameters: Type.Object({
      id: Type.String({ description: "Gate id" }),
      resolution: Type.String({ description: "Chosen resolution / answer" }),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const r = runOrca<any>(["orchestration", "gate-resolve", "--id", params.id, "--resolution", params.resolution]);
      if (!r.ok) return { content: [{ type: "text", text: `gate-resolve failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: `Resolved gate ${params.id}` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_gate_list",
    label: "Orca Gate List",
    description: "List Orca decision gates, optionally filtered by task or status.",
    promptSnippet: "List Orca decision gates",
    parameters: Type.Object({
      task: Type.Optional(Type.String({ description: "Filter by task id" })),
      status: Type.Optional(Type.String({ description: "Filter by gate status" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["orchestration", "gate-list"];
      if (params.task) args.push("--task", params.task);
      if (params.status) args.push("--status", params.status);
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `gate-list failed: ${r.error}` }], details: {} };
      const gates = r.result?.gates || [];
      if (gates.length === 0) return { content: [{ type: "text", text: "No gates." }], details: { gates: [] } };
      const lines = gates.map((g: any) => `${g.id} [${g.status}] task=${g.taskId || g.task} \u2014 ${g.question}`);
      return { content: [{ type: "text", text: lines.join("\n") }], details: { gates } };
    },
  });
}
