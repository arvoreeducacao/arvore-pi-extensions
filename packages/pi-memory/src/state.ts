export type MemoryActivity =
  | "idle"
  | "searching"
  | "injecting"
  | "saving"
  | "flushing"
  | "error"
  | "logged-out"
  | "incognito";

export interface MemorySnapshot {
  activity: MemoryActivity;
  username: string | null;
  detail: string | null;
  lastError: string | null;
  hidden: boolean;
}

type Listener = () => void;

const snapshot: MemorySnapshot = {
  activity: "logged-out",
  username: null,
  detail: null,
  lastError: null,
  hidden: false,
};

const listeners = new Set<Listener>();

export function getMemorySnapshot(): MemorySnapshot {
  return snapshot;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setActivity(activity: MemoryActivity, detail: string | null = null): void {
  snapshot.activity = activity;
  snapshot.detail = detail;
  if (activity !== "error") {
    snapshot.lastError = null;
  }
  emit();
}

export function setError(message: string): void {
  snapshot.activity = "error";
  snapshot.lastError = message;
  emit();
}

export function setUsername(username: string | null): void {
  snapshot.username = username;
  emit();
}

export function setHidden(hidden: boolean): void {
  snapshot.hidden = hidden;
  emit();
}

export function clearError(): void {
  if (snapshot.activity === "error") {
    snapshot.activity = "idle";
  }
  snapshot.lastError = null;
  emit();
}
