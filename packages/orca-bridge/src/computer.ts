import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runOrca, isOrcaSession } from "./core.js";

function notInOrca() {
  return { content: [{ type: "text" as const, text: "Not running inside an Orca session." }], details: {} };
}

function windowArgs(params: { windowId?: string; windowIndex?: number }): string[] {
  const args: string[] = [];
  if (params.windowId) args.push("--window-id", params.windowId);
  else if (typeof params.windowIndex === "number") args.push("--window-index", String(params.windowIndex));
  return args;
}

function summarizeState(result: any): string {
  const elements = result?.elements || result?.tree || [];
  if (!Array.isArray(elements) || elements.length === 0) {
    return JSON.stringify(result || {}, null, 2).slice(0, 4000);
  }
  const lines = elements.slice(0, 200).map((e: any, i: number) => {
    const idx = typeof e.index === "number" ? e.index : i;
    const role = e.role || e.type || "?";
    const label = e.label || e.title || e.value || e.text || "";
    return `[${idx}] ${role}${label ? `: ${label}` : ""}`;
  });
  return lines.join("\n");
}

export function registerComputerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "orca_computer_list_apps",
    label: "Orca List Apps",
    description: "List running desktop apps available to Orca computer-use.",
    promptSnippet: "List desktop apps for computer use",
    promptGuidelines: [
      "Use Orca computer-use tools to inspect and drive native desktop apps when running inside an Orca session (e.g. to validate a UI after implementing it).",
      "Workflow: `orca_computer_app_state` to get an accessibility snapshot with element indices, then `orca_computer_click`/`orca_computer_type` targeting those indices. Re-snapshot after navigation because indices change.",
    ],
    parameters: Type.Object({}),
    async execute() {
      if (!isOrcaSession()) return notInOrca();
      const r = runOrca<any>(["computer", "list-apps"]);
      if (!r.ok) return { content: [{ type: "text", text: `list-apps failed: ${r.error}` }], details: {} };
      const apps = r.result?.apps || [];
      const lines = apps.map((a: any) => `${a.name || a.bundleId}${a.pid ? ` (pid:${a.pid})` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No apps." }], details: { apps } };
    },
  });

  pi.registerTool({
    name: "orca_computer_list_windows",
    label: "Orca List Windows",
    description: "List visible windows for a desktop app.",
    promptSnippet: "List windows for a desktop app",
    parameters: Type.Object({
      app: Type.String({ description: "App name, bundle id, or pid:N" }),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const r = runOrca<any>(["computer", "list-windows", "--app", params.app]);
      if (!r.ok) return { content: [{ type: "text", text: `list-windows failed: ${r.error}` }], details: {} };
      const windows = r.result?.windows || [];
      const lines = windows.map((w: any, i: number) => `[${w.index ?? i}] ${w.title || "(untitled)"}${w.id ? ` id=${w.id}` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No windows." }], details: { windows } };
    },
  });

  pi.registerTool({
    name: "orca_computer_app_state",
    label: "Orca App State",
    description:
      "Capture a compact accessibility snapshot of a desktop app, returning UI elements with indices to target with click/type/set-value. Element indices change after the UI changes, so re-snapshot before interacting.",
    promptSnippet: "Snapshot a desktop app's accessibility tree",
    parameters: Type.Object({
      app: Type.String({ description: "App name, bundle id, or pid:N" }),
      windowId: Type.Optional(Type.String({ description: "Target window id" })),
      windowIndex: Type.Optional(Type.Number({ description: "Target window index" })),
      session: Type.Optional(Type.String({ description: "Snapshot namespace for a related workflow" })),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["computer", "get-app-state", "--app", params.app, "--no-screenshot", ...windowArgs(params)];
      if (params.session) args.push("--session", params.session);
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `get-app-state failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: summarizeState(r.result) }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_computer_click",
    label: "Orca Computer Click",
    description: "Click an element (by index from orca_computer_app_state) or a window coordinate in a desktop app.",
    promptSnippet: "Click in a desktop app",
    parameters: Type.Object({
      app: Type.String({ description: "App name, bundle id, or pid:N" }),
      elementIndex: Type.Optional(Type.Number({ description: "Element index from app_state" })),
      x: Type.Optional(Type.Number({ description: "Window x coordinate (use with y instead of elementIndex)" })),
      y: Type.Optional(Type.Number({ description: "Window y coordinate" })),
      windowId: Type.Optional(Type.String()),
      windowIndex: Type.Optional(Type.Number()),
      clickCount: Type.Optional(Type.Number({ description: "Number of clicks (e.g. 2 for double-click)" })),
      button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")])),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["computer", "click", "--app", params.app, "--no-screenshot", ...windowArgs(params)];
      if (typeof params.elementIndex === "number") args.push("--element-index", String(params.elementIndex));
      else if (typeof params.x === "number" && typeof params.y === "number") args.push("--x", String(params.x), "--y", String(params.y));
      else return { content: [{ type: "text", text: "Provide elementIndex or both x and y." }], details: {} };
      if (params.clickCount) args.push("--click-count", String(params.clickCount));
      if (params.button) args.push("--mouse-button", params.button);
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `click failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: "Clicked." }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_computer_type",
    label: "Orca Computer Type",
    description: "Type literal text at the current focus in a desktop app.",
    promptSnippet: "Type text into a desktop app",
    parameters: Type.Object({
      app: Type.String({ description: "App name, bundle id, or pid:N" }),
      text: Type.String({ description: "Text to type" }),
      windowId: Type.Optional(Type.String()),
      windowIndex: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["computer", "type-text", "--app", params.app, "--text", params.text, "--no-screenshot", ...windowArgs(params)];
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `type-text failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: "Typed." }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_computer_key",
    label: "Orca Computer Key",
    description: "Press a single key (e.g. Return, Escape, Tab) or a hotkey combo (e.g. CmdOrCtrl+A) in a desktop app.",
    promptSnippet: "Press a key or hotkey in a desktop app",
    parameters: Type.Object({
      app: Type.String({ description: "App name, bundle id, or pid:N" }),
      key: Type.String({ description: "Key or combo. Single key like 'Return', or combo like 'CmdOrCtrl+A'" }),
      windowId: Type.Optional(Type.String()),
      windowIndex: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const isCombo = params.key.includes("+");
      const sub = isCombo ? "hotkey" : "press-key";
      const args = ["computer", sub, "--app", params.app, "--key", params.key, "--no-screenshot", ...windowArgs(params)];
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `${sub} failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: `Pressed ${params.key}.` }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_computer_set_value",
    label: "Orca Computer Set Value",
    description: "Set the value of a settable element (by index) in a desktop app, e.g. a text field.",
    promptSnippet: "Set a desktop app element value",
    parameters: Type.Object({
      app: Type.String({ description: "App name, bundle id, or pid:N" }),
      elementIndex: Type.Number({ description: "Element index from app_state" }),
      value: Type.String({ description: "Value to set" }),
      windowId: Type.Optional(Type.String()),
      windowIndex: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["computer", "set-value", "--app", params.app, "--element-index", String(params.elementIndex), "--value", params.value, "--no-screenshot", ...windowArgs(params)];
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `set-value failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: "Value set." }], details: r.result || {} };
    },
  });

  pi.registerTool({
    name: "orca_computer_scroll",
    label: "Orca Computer Scroll",
    description: "Scroll an element (by index) or window coordinate in a desktop app.",
    promptSnippet: "Scroll a desktop app",
    parameters: Type.Object({
      app: Type.String({ description: "App name, bundle id, or pid:N" }),
      direction: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")]),
      elementIndex: Type.Optional(Type.Number({ description: "Element index to scroll" })),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      pages: Type.Optional(Type.Number({ description: "Number of pages to scroll" })),
      windowId: Type.Optional(Type.String()),
      windowIndex: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      if (!isOrcaSession()) return notInOrca();
      const args = ["computer", "scroll", "--app", params.app, "--direction", params.direction, "--no-screenshot", ...windowArgs(params)];
      if (typeof params.elementIndex === "number") args.push("--element-index", String(params.elementIndex));
      else if (typeof params.x === "number" && typeof params.y === "number") args.push("--x", String(params.x), "--y", String(params.y));
      if (params.pages) args.push("--pages", String(params.pages));
      const r = runOrca<any>(args);
      if (!r.ok) return { content: [{ type: "text", text: `scroll failed: ${r.error}` }], details: {} };
      return { content: [{ type: "text", text: `Scrolled ${params.direction}.` }], details: r.result || {} };
    },
  });
}
