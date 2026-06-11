import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';

vi.mock('vscode', () => ({
  DocumentLink: class {
    range: any;
    target: any;
    constructor(range: any, target: any) { this.range = range; this.target = target; }
  },
  Position: class {
    line: number; character: number;
    constructor(line: number, character: number) { this.line = line; this.character = character; }
  },
  Range: class {
    start: any; end: any;
    constructor(start: any, end: any) { this.start = start; this.end = end; }
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

import { SnippetLinkProvider } from '../providers/snippetLinkProvider';

describe('SnippetLinkProvider', () => {
  it('exists', () => {
    const provider = new SnippetLinkProvider();
    expect(provider).toBeInstanceOf(SnippetLinkProvider);
  });
});
