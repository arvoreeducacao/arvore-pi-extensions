import type { SecretEntry } from "./secrets.js";

export interface Redactor {
  redactString(text: string): { text: string; hits: number };
  refresh(entries: SecretEntry[]): void;
}

interface PatternRule {
  name: string;
  re: RegExp;
}

const PATTERN_RULES: PatternRule[] = [
  { name: "AWS_ACCESS_KEY", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "AWS_SECRET", re: /\b(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])\b/g },
  { name: "OPENAI_KEY", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "GITHUB_TOKEN", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "SLACK_TOKEN", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: "PRIVATE_KEY",
    re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]+?-----END[A-Z ]*PRIVATE KEY-----/g,
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createRedactor(initial: SecretEntry[]): Redactor {
  let valueRules: { re: RegExp; placeholder: string }[] = [];

  function refresh(entries: SecretEntry[]): void {
    valueRules = entries
      .filter((e) => e.value.length > 0)
      .map((e) => ({ re: new RegExp(escapeRe(e.value), "g"), placeholder: e.placeholder }));
  }

  function redactString(text: string): { text: string; hits: number } {
    if (!text) return { text, hits: 0 };
    let out = text;
    let hits = 0;
    for (const { re, placeholder } of valueRules) {
      out = out.replace(re, () => {
        hits++;
        return placeholder;
      });
    }
    for (const { name, re } of PATTERN_RULES) {
      out = out.replace(re, () => {
        hits++;
        return `$SECRET_${name}`;
      });
    }
    return { text: out, hits };
  }

  refresh(initial);
  return { redactString, refresh };
}
