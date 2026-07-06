import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type FoxState =
  | "sleep"
  | "sniff"
  | "dig"
  | "run"
  | "jump"
  | "caught"
  | "error"
  | "sad";

type RGB = [number, number, number];

const PALETTE: Record<string, RGB> = {
  O: [232, 118, 58],
  D: [198, 83, 31],
  W: [247, 240, 227],
  B: [53, 35, 26],
  N: [30, 20, 16],
  P: [232, 155, 155],
  R: [220, 70, 70],
  Y: [240, 200, 80],
  G: [150, 150, 150],
  C: [120, 180, 235],
};

interface Anim {
  label: string;
  intervalMs: number;
  once?: { durationMs: number; then: FoxState };
  grids: string[][];
}

const ANIMS: Record<FoxState, Anim> = {
  sleep: {
    label: "esperando você…",
    intervalMs: 700,
    grids: [
      ["............................", "............................", "............................", "......................G.....", "....................G.......", "....NN......NNNNNN..........", "...NWON...NNDDDDDDNN........", "...NODON.NDDOOOOOOODN.......", "..NOOOOONDOOOOOOOOOODN......", "..NOOOOODOOOOOOOOOOOODN.....", "..NOONNOOOOOOOOOOOOOOON.....", "..NOOOOOOOOOOOOOOOOWWWN.....", "...NWWWWNOOOOOOOOOWWWNN.....", "....NNNNNNNNNNNNNNNNN.......", "............................", "............................"],
      ["............................", "............................", ".......................G....", ".....................G......", "............................", "....NN......NNNNNN..........", "...NWON...NNDDDDDDNN........", "...NODON.NDDOOOOOOODN.......", "..NOOOOONDOOOOOOOOOODN......", "..NOOOOODOOOOOOOOOOOODN.....", "..NOONNOOOOOOOOOOOOOOON.....", "..NOOOOOOOOOOOOOOOOWWWN.....", "...NWWWWNOOOOOOOOOWWWNN.....", "....NNNNNNNNNNNNNNNNN.......", "............................", "............................"],
      [".........................G..", "........................G...", "......................G.....", "............................", "............................", "....NN......NNNNNN..........", "...NWON...NNDDDDDDNN........", "...NODON.NDDOOOOOOODN.......", "..NOOOOONDOOOOOOOOOODN......", "..NOOOOODOOOOOOOOOOOODN.....", "..NOONNOOOOOOOOOOOOOOON.....", "..NOOOOOOOOOOOOOOOOWWWN.....", "...NWWWWNOOOOOOOOOWWWNN.....", "....NNNNNNNNNNNNNNNNN.......", "............................", "............................"],
    ],
  },
  sniff: {
    label: "farejando o código",
    intervalMs: 280,
    grids: [
      [".................N.....N....", "................NWN...NWN...", "................NWON..NWON..", "...............NOOONNNOOON..", "...............NDOOOOOOOON..", "..............NDOOOONOOOOONG", "..............NOOOOOOOOOOONN", ".NNNN.........NOOOOOOOWWWWNN", "NDDDDN..NNNNNNOOOOOOOWWWWNN.", "NWWDDDNNDDDDDOOOOOOOOOWNNN..", ".NWWOODDOOOOOOOOOOOOOWWN....", "..NNOOOOOOOOOOOOOOOOWWWN....", "....NNNOONDNNNNDOONWWWNN....", "......NON.NON..NON.NON......", "......NBN.NBN..NBN.NBN......", ".......N...N....N...N......."],
      [".................N.....N....", "................NWN...NWN...", "................NWON..NWON..", "...............NOOONNNOOON..", "...............NDOOOOOOOONG.", "..............NDOOOONOOOOONG", "..............NOOOOOOOOOOONN", ".NNNN.........NOOOOOOOWWWWNN", "NDDDDN..NNNNNNOOOOOOOWWWWNN.", "NWWDDDNNDDDDDOOOOOOOOOWNNN..", ".NWWOODDOOOOOOOOOOOOOWWN....", "..NNOOOOOOOOOOOOOOOOWWWN....", "....NNNOONDNNNNDOONWWWNN....", "......NON.NON..NON.NON......", "......NBN.NBN..NBN.NBN......", ".......N...N....N...N......."],
      [".................N.....N....", "................NWN...NWN...", "................NWON..NWONG.", "...............NOOONNNOOON.G", "...............NDOOOOOOOONG.", "..............NDOOOONOOOOON.", "..............NOOOOOOOOOOONN", ".NNNN.........NOOOOOOOWWWWNN", "NDDDDN..NNNNNNOOOOOOOWWWWNN.", "NWWDDDNNDDDDDOOOOOOOOOWNNN..", ".NWWOODDOOOOOOOOOOOOOWWN....", "..NNOOOOOOOOOOOOOOOOWWWN....", "....NNNOONDNNNNDOONWWWNN....", "......NON.NON..NON.NON......", "......NBN.NBN..NBN.NBN......", ".......N...N....N...N......."],
    ],
  },
  dig: {
    label: "cavando na base",
    intervalMs: 220,
    grids: [
      ["..NNN.......................", ".NWWDN......NN..............", ".NWWDDN....NDDN.............", "..NOODN...NDDOON..N.....N...", "...NOODN.NDOOOOONNWN...NWN..", "....NOODNDOOOOOONWON..NWON..", ".....NODDOOOOOONOOONNNOOON..", "......NDOOOOOONDOOOOOOOON...", "......NOOOOOONDOOOONOOOOON..", ".......NOOOONOOOOOOOOOOOOON.", ".......NOONNOOOOOOOOOOOOONN.", ".......NOON.NNOOOOOOWWWWWNN.", ".......NBBN...NOOONWWWWWNN..", ".......NBBN.D.NBBN.NNNNN....", "........NN.D...NN...........", "............................"],
      ["..NNN.......................", ".NWWDN......NN..............", ".NWWDDN....NDDN.............", "..NOODN...NDDOON..N.....N...", "...NOODN.NDOOOOONNWN...NWN..", "....NOODNDOOOOOONWON..NWON..", ".....NODDOOOOOONOOONNNOOON..", "......NDOOOOOONDOOOOOOOON...", "......NOOOOOONDOOOONOOOOON..", ".......NOOOONOOOOOOOOOOOOON.", ".......NOONNOOOOOOOOOOOOONN.", ".......NOONDNNOOOOOOWWWWWNN.", ".......NBBN.D.NOOONWWWWWNN..", ".......NBBN...NBBN.NNNNN....", "........NN...D.NN...........", "............................"],
      ["..NNN.......................", ".NWWDN......NN..............", ".NWWDDN....NDDN.............", "..NOODN...NDDOON..N.....N...", "...NOODN.NDOOOOONNWN...NWN..", "....NOODNDOOOOOONWON..NWON..", ".....NODDOOOOOONOOONNNOOON..", "......NDOOOOOONDOOOOOOOON...", "......NOOOOOONDOOOONOOOOON..", ".......NOOOONOOOOOOOOOOOOON.", ".......NOONNOOOOOOOOOOOOONN.", ".......NOON.NNOOOOOOWWWWWNN.", ".......NBBN..DNOOONWWWWWNN..", ".......NBBND..NBBNDNNNNN....", "........NN..D..NN...........", "............................"],
    ],
  },
  run: {
    label: "correndo atrás",
    intervalMs: 130,
    grids: [
      [".................N.....N....", "................NWN...NWN...", "................NWON..NWON..", "...............NOOONNNOOON..", "...............NDOOOOOOOON..", "..............NDOOOONOOOOON.", "..............NOOOOOOOOOOONN", ".NNNN.........NOOOOOOOWWWWNN", "NDDDDN..NNNNNNOOOOOOOWWWWNN.", "NWWDDDNNDDDDDOOOOOOOOOWNNN..", ".NWWOODDOOOOOOOOOOOOOWWN....", "..NNOOOOOOOOOOOOOOOOWWWN....", ".G..NNNNNONNNNNNONNNNNNN....", "..G.....NON....NON..........", "........NBN....NBN..........", ".........N......N..........."],
      [".................N.....N....", "................NWN...NWN...", "................NWON..NWON..", "...............NOOONNNOOON..", "...............NDOOOOOOOON..", "..............NDOOOONOOOOON.", "..............NOOOOOOOOOOONN", ".NNNN.........NOOOOOOOWWWWNN", "NDDDDN..NNNNNNOOOOOOOWWWWNN.", "NWWDDDNNDDDDDOOOOOOOOOWNNN..", ".NWWOODDOOOOOOOOOOOOOWWN....", ".GNNOOOOOOOOOOOOOOOOWWWN....", "G...NNNONNNNNNNNNNNONNNN....", "...G..NON.........NON.......", ".....NBN...........NBN......", "......N.............N......."],
    ],
  },
  jump: {
    label: "pulando de alegria!",
    intervalMs: 160,
    grids: [
      ["....Y.......................", "..........NNNNNN....Y.......", "..NNN...NNDDDDDDNN......Y...", ".NWWDN.NDDOOOOOOODNN........", ".NWWDDNDOOOOOOOOOOODNN.N..N.", "..NOODDOOOOOOOOOOOOOONNWNNWN", "...NOODOOODNNNNNNNOOOOOOOOON", "....NNODDNN.....NOOOOOOOOOON", "..Y...NNN.......NOOOONOOOOON", ".......NBN......NNOOOOOOOONN", "........NN.......NOOOOWWWWN.", "..................NNOWWWWN..", "....................NWWWN...", ".....................NNN....", "............................", "............................"],
      [".................Y..........", "......Y...NNNNNN............", "..NNN...NNDDDDDDNN....Y.....", ".NWWDN.NDDOOOOOOODNN........", ".NWWDDNDOOOOOOOOOOODNN.N..N.", "..NOODDOOOOOOOOOOOOOONNWNNWN", "...NOODOOODNNNNNNNOOOOOOOOON", "Y...NNODDNN.....NOOOOOOOOOON", "......NNN.......NOOOONOOOOON", ".......NBN......NNOOOOOOOONN", "........NN.......NOOOOWWWWN.", "..................NNOWWWWN..", "....................NWWWN...", ".....................NNN....", "............................", "............................"],
      ["........Y...................", "..........NNNNNN...Y........", "..NNN...NNDDDDDDNN........Y.", ".NWWDN.NDDOOOOOOODNN........", ".NWWDDNDOOOOOOOOOOODNN.N..N.", "..NOODDOOOOOOOOOOOOOONNWNNWN", "Y..NOODOOODNNNNNNNOOOOOOOOON", "....NNODDNN.....NOOOOOOOOOON", "......NNN...Y...NOOOONOOOOON", ".......NBN......NNOOOOOOOONN", "........NN.......NOOOOWWWWN.", "..................NNOWWWWN..", "....................NWWWN...", ".....................NNN....", "............................", "............................"],
    ],
  },
  caught: {
    label: "pegou!",
    intervalMs: 170,
    once: { durationMs: 1600, then: "sleep" },
    grids: [
      ["........Y..N.....N..........", "..........NWN...NWN.........", "..........NWON..NWON.Y......", ".........NOOONNNOOON........", ".........NDOOOOOOOON........", ".........NDOOONOOOOON.......", "......Y..NOOOOOOOOOOONN.....", ".........NOOOOOOWWWWWNN.Y...", "........NOOOOOWWWWWNNN......", "..NNN...NDOOOWWWWWON........", ".NDDDN..NOOOWWWWWWON........", "NWWDDDN.NOOWWWWWWWON........", "NWWODDDNNOOWWWWWWON.........", ".NOOODDDOOOWWWWWWON.........", "..NNNOOOOOOWWWWOOON.........", "....NNNNNNNNNNNNNNN........."],
      ["...........N.....N..Y.......", ".......Y..NWN...NWN.........", "..........NWON..NWON........", ".........NOOONNNOOON........", ".........NDOOOOOOOON...Y....", ".........NDOOONOOOOON.......", ".........NOOOOOOOOOOONN.....", "...Y.....NOOOOOOWWWWWNN.....", "........NOOOOOWWWWWNNN......", "..NNN...NDOOOWWWWWON........", ".NDDDN..NOOOWWWWWWON........", "NWWDDDN.NOOWWWWWWWON........", "NWWODDDNNOOWWWWWWON.........", ".NOOODDDOOOWWWWWWON.........", "..NNNOOOOOOWWWWOOON.........", "....NNNNNNNNNNNNNNN........."],
    ],
  },
  error: {
    label: "ai! deu erro",
    intervalMs: 190,
    once: { durationMs: 1200, then: "sleep" },
    grids: [
      ["...........RR....N.....N....", "...........RR...NWN...NWN...", "...........RR...NWON..NWON..", "...............NOOONNNOOON..", "...........RR..NDOOOOOOOON..", "..............NDOOOONOOOOON.", "..............NOOOOOOOOOOONN", ".NNNN.........NOOOOOOOWWWWNN", "NDDDDN..NNNNNNOOOOOOOWWWWNN.", "NWWDDDNNDDDDDOOOOOOOOOWNNN..", ".NWWOODDOOOOOOOOOOOOOWWN....", "..NNOOOOOOOOOOOOOOOOWWWN....", "....NNNOONDNNNNDOONWWWNN....", "......NON.NON..NON.NON......", "......NBN.NBN..NBN.NBN......", ".......N...N....N...N......."],
      [".................N.....N....", "................NWN...NWN...", "................NWON..NWON..", "...............NOOONNNOOON..", "...............NDOOOOOOOON..", "..............NDOOOONOOOOON.", "..............NOOOOOOOOOOONN", ".NNNN.........NOOOOOOOWWWWNN", "NDDDDN..NNNNNNOOOOOOOWWWWNN.", "NWWDDDNNDDDDDOOOOOOOOOWNNN..", ".NWWOODDOOOOOOOOOOOOOWWN....", "..NNOOOOOOOOOOOOOOOOWWWN....", "....NNNOONDNNNNDOONWWWNN....", "......NON.NON..NON.NON......", "......NBN.NBN..NBN.NBN......", ".......N...N....N...N......."],
    ],
  },
  sad: {
    label: "tá difícil hoje…",
    intervalMs: 580,
    grids: [
      ["............................", "............................", "........NN........NN........", ".......NOONNNNNNNNOON.......", ".......NDNDOOOOOOONDN.......", ".......NNNDOOONOOOOON.......", ".........NOOOOCOOOOOONN.....", ".........NOOOOOOWWWWWNN.....", "........NOOOOOWWWWWNNN......", "..NNN...NDOOOWWWWWON........", ".NDDDN..NOOOWWWWWWON........", "NWWDDDN.NOOWWWWWWWON........", "NWWODDDNNOOWWWWWWON.........", ".NOOODDDOOOWWWWWWON.........", "..NNNOOOOOOWWWWOOON.........", "....NNNNNNNNNNNNNNN........."],
      ["............................", "............................", "........NN........NN........", ".......NOONNNNNNNNOON.......", ".......NDNDOOOOOOONDN.......", ".......NNNDOOONOOOOON.......", ".........NOOOOOOOOOOONN.....", ".........NOOOOCOWWWWWNN.....", "........NOOOOOWWWWWNNN......", "..NNN...NDOOOWWWWWON........", ".NDDDN..NOOOWWWWWWON........", "NWWDDDN.NOOWWWWWWWON........", "NWWODDDNNOOWWWWWWON.........", ".NOOODDDOOOWWWWWWON.........", "..NNNOOOOOOWWWWOOON.........", "....NNNNNNNNNNNNNNN........."],
    ],
  },
};

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const fg = ([r, g, b]: RGB) => `${ESC}38;2;${r};${g};${b}m`;
const bg = ([r, g, b]: RGB) => `${ESC}48;2;${r};${g};${b}m`;

function gridToAnsi(grid: string[]): string[] {
  const lines: string[] = [];
  for (let r = 0; r < grid.length; r += 2) {
    const top = grid[r];
    const bot = grid[r + 1] ?? ".".repeat(top.length);
    let line = "";
    for (let c = 0; c < top.length; c++) {
      const t = top[c] === "." ? null : PALETTE[top[c]];
      const b = bot[c] === "." ? null : PALETTE[bot[c]];
      if (!t && !b) line += `${RESET} `;
      else if (t && b) line += fg(t) + bg(b) + "▀";
      else if (t) line += `${RESET}${fg(t)}▀`;
      else line += `${RESET}${fg(b as RGB)}▄`;
    }
    lines.push(line + RESET);
  }
  return lines;
}

const RENDERED: Record<FoxState, string[][]> = Object.fromEntries(
  Object.entries(ANIMS).map(([k, a]) => [k, a.grids.map(gridToAnsi)]),
) as Record<FoxState, string[][]>;

function stateForTool(toolName: string): FoxState {
  const t = toolName.toLowerCase();
  if (/(read|grep|glob|find|search|ffgrep|list)/.test(t)) return "sniff";
  if (/(edit|write|patch|replace)/.test(t)) return "dig";
  if (/(bash|shell|exec|fetch|web|browser|curl)/.test(t)) return "run";
  return "sniff";
}

export default function catchTheFoxExtension(pi: ExtensionAPI): void {
  let ui: any = null;
  let state: FoxState = "sleep";
  let hidden = false;
  let frameIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let onceTimer: ReturnType<typeof setTimeout> | null = null;
  let errorStreak = 0;

  const WIDGET_ID = "catch-the-fox";

  function clearTimers(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (onceTimer) {
      clearTimeout(onceTimer);
      onceTimer = null;
    }
  }

  function render(): void {
    if (!ui) return;
    if (hidden) {
      try {
        ui.setWidget(WIDGET_ID, undefined);
      } catch {}
      return;
    }
    const frames = RENDERED[state];
    const frame = frames[frameIdx % frames.length];
    try {
      ui.setWidget(WIDGET_ID, [` ${ANIMS[state].label}`, "", ...frame]);
    } catch {}
  }

  function setState(next: FoxState): void {
    clearTimers();
    state = next;
    frameIdx = 0;
    render();
    if (hidden) return;
    timer = setInterval(() => {
      frameIdx++;
      render();
    }, ANIMS[state].intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    const once = ANIMS[state].once;
    if (once) {
      onceTimer = setTimeout(() => setState(once.then), once.durationMs);
      if (typeof onceTimer.unref === "function") onceTimer.unref();
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    ui = ctx.ui;
    setState("sleep");
  });

  pi.on("agent_start", async (_event, ctx) => {
    ui = ctx.ui;
    errorStreak = 0;
    setState("sniff");
  });

  pi.on("tool_execution_start", async (event: any, ctx: any) => {
    ui = ctx.ui;
    setState(stateForTool(event.toolName ?? ""));
  });

  pi.on("tool_result", async (event: any, ctx: any) => {
    ui = ctx.ui;
    if (event.isError) {
      errorStreak++;
      setState(errorStreak >= 3 ? "sad" : "error");
    } else {
      errorStreak = 0;
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    ui = ctx.ui;
    if (errorStreak >= 3) {
      setState("sad");
      return;
    }
    setState("jump");
    onceTimer = setTimeout(() => setState("caught"), 1400);
    if (typeof onceTimer.unref === "function") onceTimer.unref();
  });

  pi.on("session_shutdown", async () => {
    clearTimers();
  });

  pi.registerCommand("fox", {
    description:
      "Controla a raposa: /fox <sleep|sniff|dig|run|jump|caught|error|sad|hide|show>",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/fox requer modo interativo", "error");
        return;
      }
      ui = ctx.ui;
      const s = (args ?? "").trim().toLowerCase();
      if (s === "hide") {
        hidden = true;
        clearTimers();
        render();
        ctx.ui.notify("raposa escondida (/fox show pra voltar)", "info");
        return;
      }
      if (s === "show") {
        hidden = false;
        setState(state);
        ctx.ui.notify("raposa on!", "info");
        return;
      }
      if (s && s in ANIMS) {
        hidden = false;
        setState(s as FoxState);
        return;
      }
      ctx.ui.notify(
        `Estados: ${Object.keys(ANIMS).join(", ")} · hide · show`,
        "info",
      );
    },
  });
}
