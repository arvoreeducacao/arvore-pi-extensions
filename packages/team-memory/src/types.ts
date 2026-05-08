export const VALID_CATEGORIES = [
  "decisions",
  "conventions",
  "incidents",
  "domain",
  "gotchas",
] as const;

export const VALID_STATUSES = ["active", "superseded", "archived"] as const;

export type MemoryCategory = (typeof VALID_CATEGORIES)[number];
export type MemoryStatus = (typeof VALID_STATUSES)[number];

export interface MemoryFrontmatter {
  title: string;
  category: MemoryCategory;
  date: string;
  author?: string;
  tags?: string[];
  status?: MemoryStatus;
}

export interface MemoryEntry {
  id: string;
  path: string;
  title: string;
  category: MemoryCategory;
  date: string;
  author?: string;
  tags: string[];
  status: MemoryStatus;
  content: string;
}

export interface MemoryCatalogEntry {
  id: string;
  title: string;
  category: MemoryCategory;
  date: string;
  author?: string;
  tags: string[];
  status: MemoryStatus;
  snippet: string;
}

export class MemoryError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "MemoryError";
  }
}
