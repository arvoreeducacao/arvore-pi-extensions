const PALETTE = {
  O: [232, 118, 58], D: [198, 83, 31], W: [247, 240, 227], B: [53, 35, 26],
  N: [30, 20, 16], P: [232, 155, 155], R: [220, 70, 70], Y: [240, 200, 80],
  G: [150, 150, 150], C: [120, 180, 235],
};
const ESC = "\x1b[", RESET = ESC + "0m";
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const bg = ([r, g, b]) => `${ESC}48;2;${r};${g};${b}m`;
function g2a(grid) {
  const L = [];
  for (let r = 0; r < grid.length; r += 2) {
    const t = grid[r], b = grid[r + 1] ?? ".".repeat(t.length);
    let l = "";
    for (let c = 0; c < t.length; c++) {
      const T = t[c] === "." ? null : PALETTE[t[c]];
      const B = b[c] === "." ? null : PALETTE[b[c]];
      if (!T && !B) l += RESET + " ";
      else if (T && B) l += fg(T) + bg(B) + "▀";
      else if (T) l += RESET + fg(T) + "▀";
      else l += RESET + fg(B) + "▄";
    }
    L.push(l + RESET);
  }
  return L;
}
const A = {
  sleep: { label: "esperando você…", ms: 700, grids: [
    ["..........................", "..........................", "......................G...", "....................G.....", "...NN.....................", "..NOON....NNNNNN..........", "..NODON.NNOOOOOONN........", ".NOOOOONOOOOOOOOOON.......", ".NOOOOOOOOOOOOOOOOON......", ".NOONNOOOOOOOOOOOOOON.....", ".NOOOOOOOOOOOOOOOWWWN.....", "..NWWWWNOOOOOOOOWWWNN.....", "...NNNNNNNNNNNNNNNN.......", ".........................."],
    ["..........................", ".......................G..", ".....................G....", "..........................", "...NN.....................", "..NOON....NNNNNN..........", "..NODON.NNOOOOOONN........", ".NOOOOONOOOOOOOOOON.......", ".NOOOOOOOOOOOOOOOOON......", ".NOONNOOOOOOOOOOOOOON.....", ".NOOOOOOOOOOOOOOOWWWN.....", "..NWWWWNOOOOOOOOWWWNN.....", "...NNNNNNNNNNNNNNNN.......", ".........................."],
    ["........................G.", "......................G...", "..........................", "..........................", "...NN.....................", "..NOON....NNNNNN..........", "..NODON.NNOOOOOONN........", ".NOOOOONOOOOOOOOOON.......", ".NOOOOOOOOOOOOOOOOON......", ".NOONNOOOOOOOOOOOOOON.....", ".NOOOOOOOOOOOOOOOWWWN.....", "..NWWWWNOOOOOOOOWWWNN.....", "...NNNNNNNNNNNNNNNN.......", ".........................."]] },
  sniff: { label: "farejando o código", ms: 280, grids: [
    [".................N...N....", "................NON.NON...", "................NODNDON...", "................NOOOOON...", ".NN...........NNOOOOOON...", "NWWN.........NOOOOONOOON..", "NWWON......NNOOOOOOOOOONN.", ".NOODN....NOOOOOOOOOOOOOON", "..NOODN..NOOOOOOOOOOWWWWNG", "...NOODNNOOOOOOOOOOONWWNN.", "....NOOOOOOOOOOOOOWWNNN...", ".....NNNOODNNNDOOWWN......", ".......NOON..NOON.........", ".......NBBN..NBBN........."],
    [".................N...N....", "................NON.NON...", "................NODNDON...", "................NOOOOON...", ".NN...........NNOOOOOON...", "NWWN.........NOOOOONOOON..", "NWWON......NNOOOOOOOOOONN.", ".NOODN....NOOOOOOOOOOOOOOG", "..NOODN..NOOOOOOOOOOWWWWNG", "...NOODNNOOOOOOOOOOONWWNN.", "....NOOOOOOOOOOOOOWWNNN...", ".....NNNOODNNNDOOWWN......", ".......NOON..NOON.........", ".......NBBN..NBBN........."],
    [".................N...N....", "................NON.NON...", "................NODNDON...", "................NOOOOON...", ".NN...........NNOOOOOON...", "NWWN.........NOOOOONOOON..", "NWWON......NNOOOOOOOOOONNG", ".NOODN....NOOOOOOOOOOOOOOG", "..NOODN..NOOOOOOOOOOWWWWNN", "...NOODNNOOOOOOOOOOONWWNNG", "....NOOOOOOOOOOOOOWWNNN...", ".....NNNOODNNNDOOWWN......", ".......NOON..NOON.........", ".......NBBN..NBBN........."]] },
  dig: { label: "cavando na base", ms: 220, grids: [
    [".NN.......................", "NWWN......NN..............", "NWWON....NOON.............", ".NOON...NOOOON..N...N.....", "..NOON.NOOOOOONNON.NON....", "...NOONOOOOOOONODNDON.....", "....NOOOOOOOONOOOOOON.....", ".....NNOOOOONOOOOOOON.....", ".......NOOONOOONOOOOON....", ".......NOONOOOOOOOOOOON...", ".......NOON.NOOOOOWWDWNN..", ".......NBBN.NOONWWDWWNN...", "........NN..NBBN.NBBN.....", ".............NN...NN......"],
    [".NN.......................", "NWWN......NN..............", "NWWON....NOON.............", ".NOON...NOOOON..N...N.....", "..NOON.NOOOOOONNON.NON....", "...NOONOOOOOOONODNDON.....", "....NOOOOOOOONOOOOOON.....", ".....NNOOOOONOOOOOOON.....", ".......NOOONOOONOOOOON....", ".......NOONOOOOOOOODOON...", ".......NOON.NOOOODWWWWNN..", ".......NBBN.NOONWWWWWDN...", "........NN..NBBN.NBBN.....", ".............NN...NN......"],
    [".NN.......................", "NWWN......NN..............", "NWWON....NOON.............", ".NOON...NOOOON..N...N.....", "..NOON.NOOOOOONNON.NON....", "...NOONOOOOOOONODNDON.....", "....NOOOOOOOONOOOOOON.....", ".....NNOOOOONOOOOOOON.....", ".......NOOONOOONOODOON....", ".......NOONOOOOODOOOOON...", ".......NOON.NOOOOOWWWDNN..", ".......NBBN.NOONWWWWWNND..", "........NN..NBBN.NBBN.....", ".............NN...NN......"]] },
  run: { label: "correndo atrás", ms: 130, grids: [
    [".................N...N....", "................NON.NON...", "................NODNDON...", "................NOOOOON...", ".NN...........NNOOOOOON...", "NWWN.........NOOOOONOOON..", "NWWON......NNOOOOOOOOOONN.", ".NOODN....NOOOOOOOOOOOOOON", "..NOODN..NOOOOOOOOOOWWWWNN", "...NOODNNOOOOOOOOOOONWWNN.", "....NOOOOOOOOOOOOOWWNNN...", ".G...NNNOODNNNDOOWWN......", "G........NOON.NOON........", ".........NBBN.NBBN........"],
    [".................N...N....", "................NON.NON...", "................NODNDON...", "................NOOOOON...", ".NN...........NNOOOOOON...", "NWWN.........NOOOOONOOON..", "NWWON......NNOOOOOOOOOONN.", ".NOODN....NOOOOOOOOOOOOOON", "..NOODN..NOOOOOOOOOOWWWWNN", "...NOODNNOOOOOOOOOOONWWNN.", "G...NOOOOOOOOOOOOOWWNNN...", ".G...NNNOODNNNDOOWWN......", "..G...NOON......NOON......", ".....NBBN........NBBN....."]] },
  jump: { label: "pulando de alegria!", ms: 160, grids: [
    ["...Y......................", "........NNNNNN............", ".NN...NNOOOOOONN....Y.....", "NWWN.NOOOOOOOOOON.........", "NWWONOOOOOOOOOOOON.N...N..", ".NOONOOOODNNOOOOOONON.NON.", "..NOOOODNN..NNOOOONODNDON.", "...NNNNN......NOOOOOOOOOY.", "....NBN.......NNOOONOOOON.", ".....N.........NOOOOOOOONN", "...............NBNOOWWWWWN", "................N.NWWWWNN.", "..................NNNNN...", ".........................."],
    [".................Y........", "......Y.NNNNNN............", ".NN...NNOOOOOONN..........", "NWWN.NOOOOOOOOOON.........", "NWWONOOOOOOOOOOOON.N...N..", ".NOONOOOODNNOOOOOONON.NOY.", "..NOOOODNN..NNOOOONODNDON.", "...NNNNN......NOOOOOOOOON.", "....NBN.......NNOOONOOOON.", ".....N.........NOOOOOOOONN", "...............NBNOOWWWWWN", "...Y............N.NWWWWNN.", "..................NNNNN...", ".........................."],
    ["...........Y..............", "........NNNNNN............", ".NN...NNOOOOOONN..........", "NYWN.NOOOOOOOOOON......Y..", "NWWONOOOOOOOOOOOON.N...N..", ".NOONOOOODNNOOOOOONON.NON.", "..NOOOODNN..NNOOOONODNDON.", "...NNNNN......NOOOOOOOOON.", "....NBN.......NNOOONOOOON.", ".Y...N.........NOOOOOOOONN", "...............NBNOOWWWWWN", "................N.NWWWWNN.", "..................NNNNN...", ".........................."]] },
  caught: { label: "pegou!", ms: 170, grids: [
    [".....Y....N...N...........", ".........NON.NON..Y.......", ".........NODNDON..........", ".........NOOOOON..........", "........NOOOOOOONN........", "........NOOOOONOOON..Y....", "........NOOOOOOWWWNN......", ".NN.....NOOOOOONWWNN......", "NWWN...NOOOOWWWWNNN..Y....", "NWWON..NOOOWWWWWON........", ".NOONNNOOOWWWWWWON........", "..NOOOOOOOWWWWWWON........", "...NNOOOOOWWWWOOON........", ".....NNBBBNNNBBBNN........"],
    ["..........N...N.....Y.....", ".........NON.NON..........", "...Y.....NODNDON..........", ".........NOOOOON..........", ".....Y..NOOOOOOONN........", "........NOOOOONOOON.......", "........NOOOOOOWWWNN......", ".NN.....NOOOOOONWWNN......", "NWWN...NOOOOWWWWNNN.......", "NWWON..NOOOWWWWWON........", ".NOONNNOOOWWWWWWON..Y.....", "..NOOOOOOOWWWWWWON........", "...NNOOOOOWWWWOOON........", ".....NNBBBNNNBBBNN........"]] },
  error: { label: "ai! deu erro", ms: 190, grids: [
    [".........R.......N...N....", ".........R......NON.NON...", ".........R......NODNDON...", "................NOOOOON...", ".NN......R....NNOOOOOON...", "NWWN.........NOOOOONOOON..", "NWWON......NNOOOOOOOOOONN.", ".NOODN....NOOOOOOOOOOOOOON", "..NOODN..NOOOOOOOOOOWWWWNN", "...NOODNNOOOOOOOOOOONWWNN.", "....NOOOOOOOOOOOOOWWNNN...", ".....NNNOODNNNDOOWWN......", ".......NOON..NOON.........", ".......NBBN..NBBN........."],
    [".................N...N....", "................NON.NON...", "................NODNDON...", "................NOOOOON...", ".NN...........NNOOOOOON...", "NWWN.........NOOOOONOOON..", "NWWON......NNOOOOOOOOOONN.", ".NOODN....NOOOOOOOOOOOOOON", "..NOODN..NOOOOOOOOOOWWWWNN", "...NOODNNOOOOOOOOOOONWWNN.", "....NOOOOOOOOOOOOOWWNNN...", ".....NNNOODNNNDOOWWN......", ".......NOON..NOON.........", ".......NBBN..NBBN........."]] },
  sad: { label: "tá difícil hoje…", ms: 580, grids: [
    ["..........................", "..........................", "........NN.....NN.........", ".......NOONNNNNOON........", ".......NDNOOOOONDN........", "........NOOOOONOOON.......", "........NOOOOOCWWWNN......", ".NN.....NOOOOOONWWNN......", "NWWN...NOOOOWWWWNNN.......", "NWWON..NOOOWWWWWON........", ".NOONNNOOOWWWWWWON........", "..NOOOOOOOWWWWWWON........", "...NNOOOOOWWWWOOON........", ".....NNBBBNNNBBBNN........"],
    ["..........................", "..........................", "........NN.....NN.........", ".......NOONNNNNOON........", ".......NDNOOOOONDN........", "........NOOOOONOOON.......", "........NOOOOOOWWWNN......", ".NN.....NOOOOOCNWWNN......", "NWWN...NOOOOWWWWNNN.......", "NWWON..NOOOWWWWWON........", ".NOONNNOOOWWWWWWON........", "..NOOOOOOOWWWWWWON........", "...NNOOOOOWWWWOOON........", ".....NNBBBNNNBBBNN........"]] },
};
const seq = [
  ["sniff", "pi lendo/buscando arquivos"],
  ["dig", "pi editando código"],
  ["run", "pi rodando bash / web"],
  ["error", "uma tool falhou"],
  ["jump", "turno concluído"],
  ["caught", "comemorando"],
  ["sad", "3 erros seguidos"],
  ["sleep", "ocioso, esperando você"],
];
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  process.stdout.write(ESC + "?25l");
  for (const [state, note] of seq) {
    const a = A[state];
    const cycles = Math.max(a.grids.length * 3, 8);
    for (let i = 0; i < cycles; i++) {
      const lines = g2a(a.grids[i % a.grids.length]);
      let out = ESC + "H" + ESC + "J";
      out += `  ╭─ pi widget ──────────────────────╮\n`;
      out += `  │  ${state.padEnd(7)} — ${note}\n`;
      out += `  ├───────────────────────────────────┤\n`;
      out += `  │   ${a.label}\n`;
      out += `  │\n`;
      for (const l of lines) out += "  │   " + l + "\n";
      out += `  ╰───────────────────────────────────╯\n`;
      process.stdout.write(out);
      await sleepMs(a.ms);
    }
  }
  process.stdout.write(ESC + "?25h");
  console.log("\n(fim — a raposa passou por todos os estados)");
})();
