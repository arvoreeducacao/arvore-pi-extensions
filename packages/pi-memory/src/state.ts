export type MemoryActivity =
  | "idle"
  | "searching"
  | "injecting"
  | "saving"
  | "flushing"
  | "error"
  | "logged-out"
  | "incognito";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;

export function isActiveActivity(activity: MemoryActivity): boolean {
  return (
    activity === "searching" ||
    activity === "injecting" ||
    activity === "saving" ||
    activity === "flushing"
  );
}

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
let spinnerFrame = 0;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

export function getMemorySnapshot(): MemorySnapshot {
  return snapshot;
}

export function getSpinnerFrame(): string {
  return SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
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

function startSpinner(): void {
  if (spinnerTimer) {
    return;
  }
  spinnerTimer = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    emit();
  }, SPINNER_INTERVAL_MS);
  if (typeof spinnerTimer.unref === "function") {
    spinnerTimer.unref();
  }
}

function stopSpinner(): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
  spinnerFrame = 0;
}

function syncSpinner(): void {
  if (!snapshot.hidden && isActiveActivity(snapshot.activity)) {
    startSpinner();
  } else {
    stopSpinner();
  }
}

export function stopSpinnerTimer(): void {
  stopSpinner();
}

export function setActivity(activity: MemoryActivity, detail: string | null = null): void {
  snapshot.activity = activity;
  snapshot.detail = detail;
  if (activity !== "error") {
    snapshot.lastError = null;
  }
  syncSpinner();
  emit();
}

export function setError(message: string): void {
  snapshot.activity = "error";
  snapshot.lastError = message;
  syncSpinner();
  emit();
}

export function setUsername(username: string | null): void {
  snapshot.username = username;
  emit();
}

export function setHidden(hidden: boolean): void {
  snapshot.hidden = hidden;
  syncSpinner();
  emit();
}

export function clearError(): void {
  if (snapshot.activity === "error") {
    snapshot.activity = "idle";
  }
  snapshot.lastError = null;
  syncSpinner();
  emit();
}
