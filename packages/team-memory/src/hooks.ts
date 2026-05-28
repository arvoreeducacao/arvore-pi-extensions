import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MemoryCategory } from "./types.js";
import { MemoryStore } from "./store.js";

interface MemoryCandidate {
  category: MemoryCategory;
  title: string;
  content: string;
  confidence: number;
  turnIndex: number;
}

const pendingCandidates: MemoryCandidate[] = [];
const MAX_CANDIDATES = 5;

const DECISION_INDICATORS = [
  "we decided to",
  "we chose to",
  "we agreed to",
  "the solution is",
  "the approach is",
  "we went with",
  "we selected",
  "architecture decision",
  "design decision",
  "best practice for",
];

const GOTCHA_INDICATORS = [
  "gotcha:",
  "caveat:",
  "warning:",
  "the issue was",
  "root cause was",
  "this breaks when",
  "this fails if",
  "make sure to",
  "don't forget to",
  "be careful with",
  "watch out for",
];

const CONVENTION_INDICATORS = [
  "we always",
  "we never",
  "our convention",
  "our standard",
  "our pattern",
  "by convention",
  "we follow",
];

const INCIDENT_INDICATORS = [
  "incident:",
  "outage:",
  "bug:",
  "production issue",
  "postmortem",
  "retrospective",
];

const DOMAIN_INDICATORS = [
  "this works because",
  "the system uses",
  "the architecture is",
  "the data model",
  "the flow is",
];

function detectMemoryCategory(text: string): MemoryCategory | null {
  const lowerText = text.toLowerCase();

  for (const indicator of DECISION_INDICATORS) {
    if (lowerText.includes(indicator)) return "decisions";
  }

  for (const indicator of GOTCHA_INDICATORS) {
    if (lowerText.includes(indicator)) return "gotchas";
  }

  for (const indicator of CONVENTION_INDICATORS) {
    if (lowerText.includes(indicator)) return "conventions";
  }

  for (const indicator of INCIDENT_INDICATORS) {
    if (lowerText.includes(indicator)) return "incidents";
  }

  for (const indicator of DOMAIN_INDICATORS) {
    if (lowerText.includes(indicator)) return "domain";
  }

  return null;
}

function extractTitle(text: string, category: MemoryCategory): string {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return `New ${category} memory`;

  const firstLine = lines[0].trim();
  const maxLength = 60;

  let title = firstLine.replace(/^[\-\*\d\.]+\s*/, "");

  const indicators = [...DECISION_INDICATORS, ...GOTCHA_INDICATORS, ...CONVENTION_INDICATORS];
  for (const indicator of indicators) {
    const idx = title.toLowerCase().indexOf(indicator);
    if (idx !== -1) {
      title = title.slice(idx + indicator.length).trim();
      break;
    }
  }

  if (title.length > maxLength) {
    title = title.slice(0, maxLength).trim();
    const lastSpace = title.lastIndexOf(" ");
    if (lastSpace > 30) title = title.slice(0, lastSpace);
  }

  return title || `New ${category} memory`;
}

function extractAssistantText(message: any): string {
  if (!message) return "";
  const content = message.content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  if (typeof content === "string") return content;
  return "";
}

function checkSimilarity(candidate: MemoryCandidate, store: MemoryStore): boolean {
  const catalog = store.getCatalog().filter((m) => m.status === "active");
  const titleWords = candidate.title.toLowerCase().split(/\s+/).filter(Boolean);

  for (const memory of catalog) {
    const memoryWords = memory.title.toLowerCase().split(/\s+/).filter(Boolean);
    const overlap = titleWords.filter((w) => memoryWords.includes(w)).length;
    const similarity = overlap / Math.max(titleWords.length, memoryWords.length, 1);

    if (similarity > 0.6) return true;
  }

  return false;
}

export function getPendingCandidates(): MemoryCandidate[] {
  return [...pendingCandidates];
}

export function clearCandidate(index: number): void {
  if (index >= 0 && index < pendingCandidates.length) {
    pendingCandidates.splice(index, 1);
  }
}

export function registerMemoryHooks(pi: ExtensionAPI, store: MemoryStore) {
  pi.on("turn_end", async (event, ctx: ExtensionContext) => {
    const message = event.message;
    if (message?.role !== "assistant") return;

    const text = extractAssistantText(message);
    if (text.length < 50) return;

    const category = detectMemoryCategory(text);
    if (!category) return;

    if (pendingCandidates.length >= MAX_CANDIDATES) {
      pendingCandidates.shift();
    }

    const title = extractTitle(text, category);
    const candidate: MemoryCandidate = {
      category,
      title,
      content: text.slice(0, 2000),
      confidence: 0.7,
      turnIndex: event.turnIndex,
    };

    if (checkSimilarity(candidate, store)) return;

    pendingCandidates.push(candidate);

    if (!ctx.hasUI) return;

    ctx.ui.setWidget("memory-capture", [
      `💡 Memory candidate: "${title}" (${category})`,
      "  Type /capture to save, /dismiss to skip",
    ]);
  });

  pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
    if (pendingCandidates.length === 0) return;
    if (!ctx.hasUI) return;

    const titles = pendingCandidates.map((c) => `  - ${c.title} (${c.category})`).join("\n");
    ctx.ui.notify(`Pending memories not captured:\n${titles}`, "warning");
  });
}
