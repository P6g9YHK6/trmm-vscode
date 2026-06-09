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
