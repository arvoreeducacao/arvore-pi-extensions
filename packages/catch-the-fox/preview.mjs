const PALETTE = {
  O: [232, 118, 58], D: [198, 83, 31], W: [247, 240, 227], B: [53, 35, 26],
  N: [30, 20, 16], P: [232, 155, 155], R: [220, 70, 70], Y: [240, 200, 80],
  G: [150, 150, 150], C: [120, 180, 235],
};
const ESC = "\x1b[", RESET = ESC + "0m";
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const bg = ([r, g, b]) => `${ESC}48;2;${r};${g};${b}m`;

function gridToAnsi(grid) {
  const lines = [];
  for (let r = 0; r < grid.length; r += 2) {
    const top = grid[r], bot = grid[r + 1] ?? ".".repeat(top.length);
    let line = "";
    for (let c = 0; c < top.length; c++) {
      const t = top[c] === "." ? null : PALETTE[top[c]];
      const b = bot[c] === "." ? null : PALETTE[bot[c]];
      if (!t && !b) line += RESET + " ";
      else if (t && b) line += fg(t) + bg(b) + "▀";
      else if (t) line += RESET + fg(t) + "▀";
      else line += RESET + fg(b) + "▄";
    }
    lines.push(line + RESET);
  }
  return lines;
}

const ANIMS = {
  sleep: { label: "esperando você… (zzz)", ms: 700, grids: [
    [".O.......O..G.", ".OO.....OO.G..", ".OPO...OPO....", ".OOOOOOOOO....", ".ONONONONO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."],
    [".O.......O....", ".OO.....OO..G.", ".OPO...OPO.G..", ".OOOOOOOOO....", ".ONONONONO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."]] },
  sniff: { label: "farejando o código", ms: 300, grids: [
    [".O.......O....", ".OO.....OO....", ".OPO...OPO....", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOWW.G..", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."],
    [".O.......O....", ".OO.....OO....", ".OPO...OPO....", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOWW.GGG", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."]] },
  dig: { label: "cavando na base", ms: 240, grids: [
    [".O.......O....", ".OO.....OO....", ".OPO...OPO....", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..BWWWO.OOW.D.", "..OOOOB..WWD.."],
    [".O.......O....", ".OO.....OO....", ".OPO...OPO....", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DOD..", "..OWWWB.OOW...", "..BOOOO..WW.D."]] },
  run: { label: "correndo atrás", ms: 140, grids: [
    ["...O.......O..", "...OO.....OO..", "...OPO...OPO..", "...OOOOOOOOO..", "...OONOOONOO..", "...WWOWBWOWW..", "G..OWWWWWWWO..", "GG..OWWWO..DO.", "....OWWWO.OOW.", "....BOOOB..WW."],
    ["..O.......O...", "..OO.....OO...", "..OPO...OPO...", "..OOOOOOOOO...", "..OONOOONOO...", "..WWOWBWOWW...", "GGOWWWWWWWO...", "...OWWWO..DO..", "G..OWWWO.OOW..", "...BOOOB..WW.."]] },
  jump: { label: "pulando de alegria!", ms: 170, grids: [
    [".O.......O....", ".OO.....OO....", ".OPO...OPO....", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."],
    ["YOPO...OPO.Y..", ".OOOOOOOOO..Y.", ".OONOOONOO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW...", "..............", ".............."]] },
  caught: { label: "pegou! turno concluído", ms: 180, grids: [
    ["YO.......O..Y.", ".OO.....OO....", ".OPO...OPO..Y.", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "Y.OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."],
    [".O.......O.Y..", "YOO.....OO....", "YOPO...OPO....", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW..Y", "..BOOOB..WW..."]] },
  error: { label: "ai! deu erro", ms: 200, grids: [
    [".O.......O..R.", ".OO.....OO..R.", ".OPO...OPO....", ".OOOOOOOOO..R.", ".OONOOONOO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."],
    [".O.......O....", ".OO.....OO....", ".OPO...OPO....", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."]] },
  sad: { label: "tá difícil hoje… (orelhas caídas)", ms: 600, grids: [
    ["..............", "..............", "OOO.....OOO...", ".OOOOOOOOO....", ".OONOOONOO....", ".WCOWBWOWW....", ".OWWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."],
    ["..............", "..............", "OOO.....OOO...", ".OOOOOOOOO....", ".OONOOONOO....", ".WWOWBWOCW....", ".OCWWWWWWO....", "..OWWWO..DO...", "..OWWWO.OOW...", "..BOOOB..WW..."]] },
};

const RENDERED = Object.fromEntries(
  Object.entries(ANIMS).map(([k, a]) => [k, a.grids.map(gridToAnsi)]),
);

const order = ["sleep", "sniff", "dig", "run", "jump", "caught", "error", "sad"];
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  process.stdout.write(ESC + "?25l");
  for (const state of order) {
    const a = ANIMS[state];
    const frames = RENDERED[state];
    const cycles = 20;
    for (let i = 0; i < cycles; i++) {
      const frame = frames[i % frames.length];
      let out = ESC + "H" + ESC + "J";
      out += `\n  🦊 catch-the-fox — estado: ${state}\n`;
      out += `  ${"─".repeat(38)}\n\n`;
      for (const l of frame) out += "     " + l + "\n";
      out += `\n  ${fg(PALETTE.O)}🦊 ${a.label}${RESET}\n\n`;
      out += `  (${order.indexOf(state) + 1}/${order.length}) próximo em instantes…\n`;
      process.stdout.write(out);
      await sleepMs(a.ms);
    }
  }
  process.stdout.write(ESC + "?25h");
  process.stdout.write("\n  fim! 🦊\n");
}
run();
