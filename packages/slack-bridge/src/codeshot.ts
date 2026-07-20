interface DiffRow {
  kind: "add" | "del" | "ctx";
  text: string;
}

const BG = "#0d1117";
const CARD = "#161b22";
const HEADER = "#1c2128";
const TEXT = "#c9d1d9";
const LINE_NO = "#636e7b";
const ADD_BG = "#1a3326";
const DEL_BG = "#3a1d1f";
const ADD_MARK = "#3fb950";
const DEL_MARK = "#f85149";
const GREEN = "#7ee787";
const RED = "#ff7b72";

const FONT_SIZE = 15;
const LINE_H = 22;
const PAD = 20;
const HEADER_H = 40;
const GUTTER = 54;
const CHAR_W = 9.02;
const MARGIN = 16;
const MAX_ROWS = 60;
const MAX_COLS = 120;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseDiffRows(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const raw of diff.replace(/\n$/, "").split("\n")) {
    let kind: DiffRow["kind"] = "ctx";
    let s = raw;
    if (raw.startsWith("+")) {
      kind = "add";
      s = raw.slice(1);
    } else if (raw.startsWith("-")) {
      kind = "del";
      s = raw.slice(1);
    } else if (raw.startsWith(" ")) {
      s = raw.slice(1);
    }
    rows.push({ kind, text: s.replace(/\t/g, "    ") });
  }
  return rows;
}

export function buildUnifiedDiff(oldText: string, newText: string): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push(` ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push(`-${a[i]}`);
      i++;
    } else {
      rows.push(`+${b[j]}`);
      j++;
    }
  }
  while (i < n) rows.push(`-${a[i++]}`);
  while (j < m) rows.push(`+${b[j++]}`);
  return rows.join("\n");
}

export interface DiffShot {
  title: string;
  diff: string;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function buildDiffShot(toolName: string, args: unknown): DiffShot | undefined {
  const a = (args ?? {}) as Record<string, unknown>;
  if (toolName === "edit") {
    const path = typeof a.path === "string" ? a.path : "";
    const edits = Array.isArray(a.edits) ? a.edits : [];
    const chunks: string[] = [];
    for (const raw of edits) {
      const e = raw as { oldText?: unknown; newText?: unknown };
      const oldText = typeof e?.oldText === "string" ? e.oldText : "";
      const newText = typeof e?.newText === "string" ? e.newText : "";
      if (!oldText && !newText) continue;
      chunks.push(buildUnifiedDiff(oldText, newText));
    }
    if (chunks.length === 0) return undefined;
    return { title: basename(path), diff: chunks.join("\n") };
  }
  if (toolName === "write") {
    const path = typeof a.path === "string" ? a.path : "";
    const content = typeof a.content === "string" ? a.content : "";
    if (!content) return undefined;
    const diff = content
      .split("\n")
      .map((l) => `+${l}`)
      .join("\n");
    return { title: basename(path), diff };
  }
  return undefined;
}

export async function renderCodeshot(title: string, diff: string): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  let rows = parseDiffRows(diff);
  let truncatedRows = false;
  if (rows.length > MAX_ROWS) {
    rows = rows.slice(0, MAX_ROWS);
    truncatedRows = true;
  }

  const displayRows = rows.map((r) => ({
    ...r,
    text: r.text.length > MAX_COLS ? `${r.text.slice(0, MAX_COLS)}\u2026` : r.text,
  }));

  const widestCols = displayRows.reduce((m, r) => Math.max(m, r.text.length), title.length);
  const cardW = Math.max(360, Math.ceil(GUTTER + widestCols * CHAR_W + PAD));
  const bodyRows = displayRows.length + (truncatedRows ? 1 : 0);
  const cardH = HEADER_H + PAD * 2 + bodyRows * LINE_H;
  const w = cardW + MARGIN * 2;
  const h = cardH + MARGIN * 2;

  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${BG}"/>`);
  parts.push(`<rect x="${MARGIN}" y="${MARGIN}" width="${cardW}" height="${cardH}" rx="10" fill="${CARD}"/>`);
  parts.push(
    `<path d="M${MARGIN},${MARGIN + 10} a10,10 0 0 1 10,-10 h${cardW - 20} a10,10 0 0 1 10,10 v30 h-${cardW} z" fill="${HEADER}"/>`,
  );

  const dots = ["#ff5f56", "#ffbd2e", "#27c93f"];
  dots.forEach((c, i) => {
    parts.push(`<circle cx="${MARGIN + 20 + i * 20}" cy="${MARGIN + 20}" r="6" fill="${c}"/>`);
  });
  parts.push(
    `<text x="${MARGIN + cardW / 2}" y="${MARGIN + 25}" fill="${LINE_NO}" font-family="Menlo,monospace" font-size="${FONT_SIZE}" text-anchor="middle">${escapeXml(title)}</text>`,
  );

  const bodyTop = MARGIN + HEADER_H + PAD;
  let ln = 0;
  displayRows.forEach((r, i) => {
    const ry = bodyTop + i * LINE_H;
    let color = TEXT;
    let mark = " ";
    if (r.kind === "add") {
      color = GREEN;
      mark = "+";
      parts.push(`<rect x="${MARGIN + 1}" y="${ry - 3}" width="${cardW - 2}" height="${LINE_H}" fill="${ADD_BG}"/>`);
      parts.push(`<rect x="${MARGIN + 1}" y="${ry - 3}" width="3" height="${LINE_H}" fill="${ADD_MARK}"/>`);
    } else if (r.kind === "del") {
      color = RED;
      mark = "-";
      parts.push(`<rect x="${MARGIN + 1}" y="${ry - 3}" width="${cardW - 2}" height="${LINE_H}" fill="${DEL_BG}"/>`);
      parts.push(`<rect x="${MARGIN + 1}" y="${ry - 3}" width="3" height="${LINE_H}" fill="${DEL_MARK}"/>`);
    }
    const baseline = ry + FONT_SIZE;
    if (r.kind !== "del") {
      ln += 1;
      parts.push(
        `<text x="${MARGIN + 14}" y="${baseline}" fill="${LINE_NO}" font-family="Menlo,monospace" font-size="${FONT_SIZE}">${ln}</text>`,
      );
    }
    parts.push(
      `<text x="${MARGIN + GUTTER - 16}" y="${baseline}" fill="${color}" font-family="Menlo,monospace" font-size="${FONT_SIZE}">${mark}</text>`,
    );
    parts.push(
      `<text x="${MARGIN + GUTTER}" y="${baseline}" fill="${color}" font-family="Menlo,monospace" font-size="${FONT_SIZE}" xml:space="preserve">${escapeXml(r.text)}</text>`,
    );
  });

  if (truncatedRows) {
    const ry = bodyTop + displayRows.length * LINE_H;
    parts.push(
      `<text x="${MARGIN + GUTTER}" y="${ry + FONT_SIZE}" fill="${LINE_NO}" font-family="Menlo,monospace" font-size="${FONT_SIZE}">\u2026 (truncated)</text>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
