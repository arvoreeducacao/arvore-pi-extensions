import { createHash } from "node:crypto";

export interface StoredContent {
  id: string;
  original: string;
  role: string;
  chars: number;
  turnStored: number;
}

export function createContentStore() {
  const store = new Map<string, StoredContent>();

  function makeId(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 10);
  }

  function put(text: string, role: string, turn: number): string {
    const id = makeId(text);
    if (!store.has(id)) {
      store.set(id, { id, original: text, role, chars: text.length, turnStored: turn });
    }
    return id;
  }

  function get(id: string): StoredContent | undefined {
    return store.get(id);
  }

  function has(id: string): boolean {
    return store.has(id);
  }

  function size(): number {
    return store.size;
  }

  return { put, get, has, size, makeId };
}

export type ContentStore = ReturnType<typeof createContentStore>;
