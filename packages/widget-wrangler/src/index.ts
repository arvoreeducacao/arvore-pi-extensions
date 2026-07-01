import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ExtensionWidgetOptions,
  WidgetPlacement,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CUSTOM_TYPE = "widget-wrangler-config";
const OWN_WIDGET_KEY = "widget-wrangler";

function configPath(): string {
  return join(getAgentDir(), "widget-wrangler.json");
}

function loadGlobalConfig(): string[] | null {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const data = JSON.parse(raw) as WranglerState | undefined;
    return Array.isArray(data?.disabled) ? data.disabled : null;
  } catch {
    return null;
  }
}

function saveGlobalConfig(state: WranglerState): boolean {
  try {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

type WidgetContent = Parameters<ExtensionUIContext["setWidget"]>[1];

interface WidgetRecord {
  content: WidgetContent;
  options?: ExtensionWidgetOptions;
  rendered: boolean;
}

interface WranglerState {
  disabled: string[];
}

export default function widgetWranglerExtension(pi: ExtensionAPI) {
  const registry = new Map<string, WidgetRecord>();
  const disabled = new Set<string>();
  let originalSetWidget: ExtensionUIContext["setWidget"] | null = null;
  let patchedUi: ExtensionUIContext | null = null;

  function persist(): boolean {
    return saveGlobalConfig({ disabled: Array.from(disabled) });
  }

  function restoreConfig(ctx: ExtensionContext) {
    let saved = loadGlobalConfig();
    if (saved === null) {
      const legacy = readLegacyBranchConfig(ctx);
      saved = legacy;
      saveGlobalConfig({ disabled: saved });
    }
    disabled.clear();
    for (const key of saved) disabled.add(key);
  }

  function readLegacyBranchConfig(ctx: ExtensionContext): string[] {
    const entries = ctx.sessionManager.getBranch();
    let saved: string[] | undefined;
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) {
        const data = entry.data as WranglerState | undefined;
        if (data?.disabled) saved = data.disabled;
      }
    }
    return saved ?? [];
  }

  function isEnabled(key: string): boolean {
    return !disabled.has(key);
  }

  function applyWidget(key: string) {
    if (!originalSetWidget) return;
    const record = registry.get(key);
    if (!record) return;
    if (isEnabled(key) && record.content !== undefined) {
      originalSetWidget(key, record.content as never, record.options);
      record.rendered = true;
    } else if (record.rendered) {
      originalSetWidget(key, undefined, record.options);
      record.rendered = false;
    }
  }

  function patchSetWidget(ui: ExtensionUIContext) {
    if (patchedUi === ui && originalSetWidget) return;
    originalSetWidget = ui.setWidget.bind(ui);
    patchedUi = ui;

    const wrapped: ExtensionUIContext["setWidget"] = ((
      key: string,
      content: WidgetContent,
      options?: ExtensionWidgetOptions,
    ) => {
      if (key === OWN_WIDGET_KEY) {
        originalSetWidget?.(key, content as never, options);
        return;
      }
      if (content === undefined) {
        registry.delete(key);
        originalSetWidget?.(key, undefined, options);
        return;
      }
      const existing = registry.get(key);
      registry.set(key, {
        content,
        options,
        rendered: existing?.rendered ?? false,
      });
      applyWidget(key);
    }) as ExtensionUIContext["setWidget"];

    (ui as { setWidget: ExtensionUIContext["setWidget"] }).setWidget = wrapped;
  }

  function placementLabel(placement: WidgetPlacement | undefined): string {
    return placement === "belowEditor" ? "below" : "above";
  }

  function buildItems(): SettingItem[] {
    const keys = Array.from(registry.keys()).sort((a, b) => a.localeCompare(b));
    return keys.map((key) => {
      const record = registry.get(key);
      const enabled = isEnabled(key);
      return {
        id: key,
        label: key,
        description: `${placementLabel(record?.options?.placement)} editor${record?.content === undefined ? " · idle" : ""}`,
        currentValue: enabled ? "shown" : "hidden",
        values: ["shown", "hidden"],
      };
    });
  }

  function setHidden(key: string, hidden: boolean, ui?: ExtensionUIContext) {
    if (hidden) disabled.add(key);
    else disabled.delete(key);
    applyWidget(key);
    if (!persist()) {
      ui?.notify(`Failed to save widget-wrangler config to ${configPath()} 🤠`, "error");
    }
  }

  async function openPanel(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Widget Wrangler needs TUI mode 🤠", "error");
      return;
    }

    const items = buildItems();
    if (items.length === 0) {
      ctx.ui.notify("No widgets to wrangle yet 🤠 — the corral is empty", "info");
      return;
    }

    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(
        new Text(
          `${theme.fg("accent", theme.bold("🤠 Widget Wrangler"))}  ${theme.fg("muted", "space/enter toggles · esc closes")}`,
          1,
          1,
        ),
      );

      const settingsList = new SettingsList(
        buildItems(),
        Math.min(items.length + 2, 15),
        getSettingsListTheme(),
        (id, newValue) => {
          setHidden(id, newValue === "hidden", ctx.ui);
          tui.requestRender();
        },
        () => done(undefined),
        { enableSearch: true },
      );
      container.addChild(settingsList);

      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          settingsList.handleInput?.(data);
          tui.requestRender();
        },
      };
    });
  }

  pi.registerCommand("wrangle", {
    description: "🤠 Wrangle the widget herd — show/hide widgets from any extension",
    handler: async (_args, ctx) => {
      await openPanel(ctx);
    },
  });

  pi.registerFlag("widget-wrangler-key", {
    description: "Keybinding that opens the Widget Wrangler panel (e.g. ctrl+shift+g, alt+w). Empty disables the shortcut.",
    type: "string",
    default: "ctrl+shift+g",
  });

  const shortcutKey = String(pi.getFlag("widget-wrangler-key") ?? "").trim();
  if (shortcutKey) {
    pi.registerShortcut(shortcutKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
      description: "🤠 Open the Widget Wrangler",
      handler: async (ctx) => {
        await openPanel(ctx);
      },
    });
  }

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    patchSetWidget(ctx.ui);
    restoreConfig(ctx);
    for (const key of registry.keys()) applyWidget(key);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (!ctx.hasUI) return;
    patchSetWidget(ctx.ui);
    restoreConfig(ctx);
    for (const key of registry.keys()) applyWidget(key);
  });
}
