export interface ScoredMessage {
  text: string;
  index: number;
}

interface TermStats {
  df: number;
  idf: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function buildVocab(docs: string[][]): Map<string, TermStats> {
  const vocab = new Map<string, TermStats>();
  const N = docs.length;

  for (const doc of docs) {
    const seen = new Set<string>();
    for (const term of doc) {
      if (!seen.has(term)) {
        seen.add(term);
        const existing = vocab.get(term);
        if (existing) {
          existing.df++;
        } else {
          vocab.set(term, { df: 1, idf: 0 });
        }
      }
    }
  }

  for (const [, stats] of vocab) {
    stats.idf = Math.log((N - stats.df + 0.5) / (stats.df + 0.5) + 1);
  }

  return vocab;
}

function computeBM25(
  docTokens: string[],
  queryTokens: string[],
  vocab: Map<string, TermStats>,
  avgDl: number,
  k1 = 1.2,
  b = 0.75
): number {
  const dl = docTokens.length;
  const tf = new Map<string, number>();

  for (const term of docTokens) {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTokens) {
    const stats = vocab.get(term);
    if (!stats) continue;

    const termFreq = tf.get(term) ?? 0;
    if (termFreq === 0) continue;

    const numerator = termFreq * (k1 + 1);
    const denominator = termFreq + k1 * (1 - b + b * (dl / avgDl));
    score += stats.idf * (numerator / denominator);
  }

  return score;
}

export function bm25Score(
  messages: ScoredMessage[],
  query: string
): Map<number, number> {
  const result = new Map<number, number>();
  if (messages.length === 0 || !query.trim()) return result;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return result;

  const docTokensList = messages.map((m) => tokenize(m.text));
  const vocab = buildVocab(docTokensList);
  const avgDl = docTokensList.reduce((s, d) => s + d.length, 0) / docTokensList.length;

  const scores: number[] = [];
  for (const docTokens of docTokensList) {
    scores.push(computeBM25(docTokens, queryTokens, vocab, avgDl));
  }

  const maxScore = Math.max(...scores, 1);

  for (let i = 0; i < messages.length; i++) {
    result.set(messages[i].index, scores[i] / maxScore);
  }

  return result;
}
