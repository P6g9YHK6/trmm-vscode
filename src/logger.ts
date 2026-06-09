export interface Logger {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

export class ConsoleLogger implements Logger {
  appendLine(value: string): void {
    console.log(value);
  }
  show(): void {
    // no-op for CLI
  }
}

export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(toErrorMessage(e));
}
