import * as vscode from 'vscode';
import { getConfig } from './utils/config';

export interface Logger {
  appendLine(value: string): void;
  verbose(value: string): void;
  show(preserveFocus?: boolean): void;
}

export class ConsoleLogger implements Logger {
  appendLine(value: string): void {
    console.log(value);
  }
  verbose(value: string): void {
    console.log('[verbose]', value);
  }
  show(): void {
    // no-op for CLI
  }
}

export class LogChannel implements Logger {
  private channel: vscode.OutputChannel;

  constructor(channel: vscode.OutputChannel) {
    this.channel = channel;
  }

  appendLine(value: string): void {
    this.channel.appendLine(value);
  }

  verbose(value: string): void {
    if (getConfig().verboseLogging) {
      this.channel.appendLine(`[verbose] ${value}`);
    }
  }

  show(preserveFocus?: boolean): void {
    this.channel.show(preserveFocus);
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
