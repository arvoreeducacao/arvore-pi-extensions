import { getMemorySnapshot, subscribe, type MemoryActivity } from "./state.js";

const WIDGET_KEY = "pi-memory";

interface ActivityStyle {
  icon: string;
  label: string;
  color: string;
}

function styleFor(activity: MemoryActivity): ActivityStyle {
  switch (activity) {
    case "searching":
      return { icon: "🔍", label: "buscando memórias", color: "accent" };
    case "injecting":
      return { icon: "🧠", label: "injetando contexto", color: "accent" };
    case "saving":
      return { icon: "💾", label: "salvando memória", color: "accent" };
    case "flushing":
      return { icon: "⏫", label: "capturando sessão", color: "dim" };
    case "error":
      return { icon: "⚠️", label: "falha", color: "error" };
    case "logged-out":
      return { icon: "🔒", label: "não logado (/memory-login)", color: "warning" };
    case "incognito":
      return { icon: "🕶️", label: "incognito", color: "muted" };
    case "idle":
    default:
      return { icon: "🌱", label: "pronto", color: "dim" };
  }
}

let widgetRegistered = false;
let uiCtx: any = null;
let unsubscribe: (() => void) | null = null;

function truncate(line: string, width: number): string {
  if (line.length <= width) return line;
  if (width <= 1) return line.slice(0, Math.max(0, width));
  return `${line.slice(0, width - 1)}…`;
}

export function updateMemoryWidget(ctx: any): void {
  if (ctx !== uiCtx) {
    if (widgetRegistered && uiCtx) {
      try {
        uiCtx.ui.setWidget(WIDGET_KEY, undefined);
      } catch {}
    }
    widgetRegistered = false;
    uiCtx = ctx;
  }

  if (!unsubscribe) {
    unsubscribe = subscribe(() => {
      if (uiCtx?.ui?.requestRender) {
        try {
          uiCtx.ui.requestRender();
        } catch {}
      }
    });
  }

  const snapshot = getMemorySnapshot();
  if (snapshot.hidden) {
    if (widgetRegistered) {
      try {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
      } catch {}
      widgetRegistered = false;
    }
    return;
  }

  if (widgetRegistered) {
    return;
  }

  ctx.ui.setWidget(
    WIDGET_KEY,
    (_tui: any, theme: any) => ({
      render(width: number): string[] {
        const snap = getMemorySnapshot();
        const style = styleFor(snap.activity);
        const user = snap.username ? ` (${snap.username})` : "";
        const head = `${style.icon} memory${user}: ${style.label}`;
        const lines = [theme.fg(style.color, truncate(head, width))];
        if (snap.activity === "error" && snap.lastError) {
          lines.push(theme.fg("error", truncate(`   ${snap.lastError}`, width)));
        } else if (snap.detail) {
          lines.push(theme.fg("dim", truncate(`   ${snap.detail}`, width)));
        }
        return lines;
      },
      invalidate(): void {
        widgetRegistered = false;
      },
    }),
    { placement: "aboveEditor" },
  );
  widgetRegistered = true;
}

export function disposeMemoryWidget(ctx: any): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (widgetRegistered) {
    try {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    } catch {}
    widgetRegistered = false;
  }
  uiCtx = null;
}
