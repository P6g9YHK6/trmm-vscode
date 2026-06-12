import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanChanges, ScmChange } from '../scmProvider';
import { SyncManifest } from '../sync/syncEngine';
import { sha256 } from '../sync/hash';
import { buildFileContent, ScriptMetadata } from '../sync/metadata';
import { getTmpDir } from './setup';

vi.mock('vscode', () => ({
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: 'file', path: p }),
  },
  scm: {
    createSourceControl: vi.fn(() => ({
      inputBox: { visible: false },
      createResourceGroup: vi.fn(() => ({ resourceStates: [] })),
      dispose: vi.fn(),
      count: 0,
    })),
  },
}));

describe('scanChanges', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'scm-test', Math.random().toString(36).slice(2));
  });

  afterEach(() => {
    fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  function manifest(files: Record<string, { id: number; type: 'script' | 'snippet' | 'report' }>): SyncManifest {
    return { version: 1, files };
  }

  function changeType(changes: ScmChange[], relPath: string): string | undefined {
    return changes.find(c => c.relPath === relPath)?.type;
  }

  function writeScript(relPath: string, code: string): void {
    const fullPath = path.join(syncFolder, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const meta: ScriptMetadata = {
      name: path.basename(relPath, '.ps1'),
      description: '', shell: 'powershell', category: '',
      supported_platforms: [], args: [], env_vars: [],
      default_timeout: 90, run_as_user: false, syntax: '',
      favorite: false, hidden: false, code_hash: sha256(code), ids: {},
    };
    meta.meta_hash = sha256('');
    fs.writeFileSync(fullPath, buildFileContent(code, meta), 'utf-8');
  }

  it('returns empty for empty manifest and empty folder', () => {
    const changes = scanChanges(syncFolder, manifest({}));
    expect(changes).toEqual([]);
  });

  it('detects added files not in manifest', () => {
    writeScript(path.join('scripts', 'test.ps1'), 'Write-Host "hello"');
    const changes = scanChanges(syncFolder, manifest({}));
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('added');
  });

  it('detects modified files when code changes', () => {
    const relPath = path.join('scripts', 'test.ps1');
    writeScript(relPath, 'echo 1');

    // Simulate a code edit by overwriting with different code but same metadata hash
    const fullPath = path.join(syncFolder, relPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const edited = content.replace('echo 1', 'echo 2');
    fs.writeFileSync(fullPath, edited, 'utf-8');

    const changes = scanChanges(syncFolder, manifest({ [relPath]: { id: 1, type: 'script' } }));
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('modified');
  });

  it('skips files that match their manifest hash', () => {
    const relPath = path.join('scripts', 'test.ps1');
    const code = 'Write-Host "hello"';
    writeScript(relPath, code);

    const changes = scanChanges(syncFolder, manifest({ [relPath]: { id: 1, type: 'script' } }));
    expect(changes).toHaveLength(0);
  });

  it('detects deleted files in manifest but missing on disk', () => {
    const relPath = path.join('scripts', 'gone.ps1');
    const changes = scanChanges(syncFolder, manifest({ [relPath]: { id: 1, type: 'script' } }));
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('deleted');
  });

  it('combines added, modified, and deleted correctly', () => {
    const existingRel = path.join('scripts', 'existing.ps1');
    writeScript(existingRel, 'echo hi');

    const newRel = path.join('snippets', 'new.ps1');
    writeScript(newRel, 'Write-Host "new"');

    const deletedRel = path.join('scripts', 'deleted.ps1');

    const m = manifest({
      [existingRel]: { id: 1, type: 'script' },
      [deletedRel]: { id: 2, type: 'script' },
    });
    const changes = scanChanges(syncFolder, m);

    expect(changeType(changes, existingRel)).toBeUndefined();
    expect(changeType(changes, newRel)).toBe('added');
    expect(changeType(changes, deletedRel)).toBe('deleted');
  });

  it('detects snippets in snippets subdir', () => {
    const relPath = path.join('snippets', 'test_snippet.ps1');
    writeScript(relPath, 'Write-Host "hi"');

    const changes = scanChanges(syncFolder, manifest({}));
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('added');
    expect(changes[0].relPath).toBe(relPath);
  });

  it('ignores non-script files', () => {
    const fullPath = path.join(syncFolder, 'scripts', 'readme.md');
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, '# readme');

    const changes = scanChanges(syncFolder, manifest({}));
    expect(changes).toHaveLength(0);
  });
});
