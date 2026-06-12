import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { sha256 } from './sync/hash';
import { isScriptFile, inferShell } from './utils/pathBuilder';
import { parseMetadata, parseBlockCommentMetadata } from './sync/metadata';
import { loadManifest, SyncManifest } from './sync/syncEngine';

function tryParseMetadata(content: string, shell: string) {
  if (shell === 'powershell' || shell === 'python' || shell === 'deno') {
    const blockParsed = parseBlockCommentMetadata(content);
    if (blockParsed) return blockParsed;
  }
  return parseMetadata(content, shell);
}

function scanDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      results.push(...scanDir(full));
    } else if (entry.isFile() && isScriptFile(full)) {
      results.push(full);
    }
  }
  return results;
}

function readFileSafe(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

export interface ScmChange {
  uri: vscode.Uri;
  type: 'added' | 'modified' | 'deleted';
  relPath: string;
}

export function scanChanges(syncFolder: string, manifest: SyncManifest): ScmChange[] {
  const changes: ScmChange[] = [];
  const seenOnDisk = new Set<string>();

  for (const subdir of ['scripts', 'snippets']) {
    const dir = path.join(syncFolder, subdir);
    const files = scanDir(dir);
    for (const filePath of files) {
      const relPath = path.relative(syncFolder, filePath);
      seenOnDisk.add(relPath);

      const manifestEntry = manifest.files[relPath];
      if (!manifestEntry) {
        changes.push({ uri: vscode.Uri.file(filePath), type: 'added', relPath });
        continue;
      }

      const content = readFileSafe(filePath);
      if (content) {
        const shell = inferShell(filePath);
        const parsed = tryParseMetadata(content, shell);
        if (parsed) {
          const codeHash = sha256(parsed.code);
          if (codeHash !== parsed.metadata.code_hash) {
            changes.push({ uri: vscode.Uri.file(filePath), type: 'modified', relPath });
          }
        }
      }
    }
  }

  for (const relPath of Object.keys(manifest.files)) {
    if (!seenOnDisk.has(relPath)) {
      const fullPath = path.join(syncFolder, relPath);
      changes.push({ uri: vscode.Uri.file(fullPath), type: 'deleted', relPath });
    }
  }

  return changes;
}

class ScmResource implements vscode.SourceControlResourceState {
  readonly resourceUri: vscode.Uri;
  readonly command?: vscode.Command;
  readonly contextValue: string;

  constructor(uri: vscode.Uri, type: 'added' | 'modified' | 'deleted') {
    this.resourceUri = uri;
    this.contextValue = `trmm:${type}`;
    this.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
  }
}

export class TrmmScmProvider implements vscode.Disposable {
  private scm: vscode.SourceControl;
  private groups: {
    scripts: vscode.SourceControlResourceGroup;
    snippets: vscode.SourceControlResourceGroup;
  };
  private _syncFolder: string;

  constructor(syncFolder: string) {
    this._syncFolder = syncFolder;
    this.scm = vscode.scm.createSourceControl('trmm', 'TRMM');
    this.scm.inputBox.visible = false;

    this.groups = {
      scripts: this.scm.createResourceGroup('scripts', 'Scripts'),
      snippets: this.scm.createResourceGroup('snippets', 'Snippets'),
    };
  }

  refresh(): void {
    const manifest = loadManifest(this._syncFolder);
    const changes = scanChanges(this._syncFolder, manifest);

    this.groups.scripts.resourceStates = changes
      .filter(c => !c.relPath.startsWith('snippets' + path.sep))
      .map(c => new ScmResource(c.uri, c.type));

    this.groups.snippets.resourceStates = changes
      .filter(c => c.relPath.startsWith('snippets' + path.sep))
      .map(c => new ScmResource(c.uri, c.type));

    const total = this.groups.scripts.resourceStates.length + this.groups.snippets.resourceStates.length;
    this.scm.count = total;
  }

  dispose(): void {
    this.scm.dispose();
  }
}
