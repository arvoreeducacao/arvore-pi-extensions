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
    [".O.......O.G.", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."],
    [".O.......OG..", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."]] },
  sniff: { label: "farejando o código", ms: 280, grids: [
    [".O.......O...", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWWG..", ".OWWWWWWWO...", "..BOOOOOB...."],
    [".O.......O...", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWWGG.", ".OWWWWWWWO...", "..BOOOOOB...."],
    [".O.......O...", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWWGGG", ".OWWWWWWWO...", "..BOOOOOB...."]] },
  dig: { label: "cavando na base", ms: 220, grids: [
    [".O.......O...", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO.D.", "..BOOOOOBD..."],
    [".O.......O...", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", "D.OWWWWWWWO..", ".DBOOOOOB...."]] },
  run: { label: "correndo atrás", ms: 130, grids: [
    ["...O.......O.", "...OO.....OO.", "...OPO...OPO.", "...OOOOOOOOO.", "...OONOOONOO.", "G..WWOWBWOWW.", "GG.OWWWWWWWO.", "...BOOOOOB..."],
    ["..O.......O..", "..OO.....OO..", "..OPO...OPO..", "..OOOOOOOOO..", "..OONOOONOO..", "GG.WWOWBWOWW.", "G..OWWWWWWWO.", "...BOOOOOB..."]] },
  jump: { label: "pulando de alegria!", ms: 160, grids: [
    [".O.......O...", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."],
    ["YO.......O.Y.", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."],
    [".O..Y..Y.O...", "YOO.....OO.Y.", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."],
    ["YO.......O.Y.", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."]] },
  caught: { label: "pegou!", ms: 170, grids: [
    ["YO.......O.Y.", ".OO.....OO...", "Y.PO...OPO.Y.", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."],
    [".O..Y.Y..O...", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", "Y.ONOOONOO.Y.", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."]] },
  error: { label: "ai! deu erro", ms: 190, grids: [
    [".O.......O.R.", ".OO.....OO.R.", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."],
    [".O.......O...", ".OO.....OO...", ".OPO...OPO...", ".OOOOOOOOO...", ".OONOOONOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."]] },
  sad: { label: "tá difícil hoje…", ms: 580, grids: [
    [".............", "OO.......OO..", ".OO.....OO...", ".OOOOOOOOO...", ".OOCOOOCOO...", ".WWOWBWOWW...", ".OWWWWWWWO...", "..BOOOOOB...."],
    [".............", "OO.......OO..", ".OO.....OO...", ".OOOOOOOOO...", ".OOCOOOCOO...", ".WWOCBCOWW...", ".OWWWWWWWO...", "..BOOOOOB...."]] },
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
