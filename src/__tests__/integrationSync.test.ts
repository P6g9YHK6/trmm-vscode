import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: {
      create: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ data: [] }),
        post: vi.fn().mockResolvedValue({ data: {} }),
        put: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({}),
      })),
    },
  };
});

vi.mock('../sync/reportSync', () => ({
  pullReportsFromApi: vi.fn().mockResolvedValue({ pulled: 0, created: 0, deleted: 0, skipped: 0, errors: [] }),
  pushReportsToApi: vi.fn().mockResolvedValue({ pushed: 0, created: 0, deleted: 0, skipped: 0, errors: [] }),
  deleteReportFromApi: vi.fn().mockResolvedValue(true),
  scanReportManifest: vi.fn().mockReturnValue({}),
}));

vi.mock('../sync/gitSync', () => ({
  commitSyncChanges: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, def: unknown) => {
        if (key === 'stripMetadata') return true;
        return def;
      }),
    })),
  },
  window: {
    showWarningMessage: vi.fn().mockResolvedValue('Rebuild from local'),
  },
}));

import axios from 'axios';
import { pullFromApi, pushToApi, SyncResult } from '../sync/syncEngine';
import { getTmpDir } from './setup';
import { hashUrl, sha256 } from '../sync/hash';
import { buildScriptPath } from '../utils/pathBuilder';
import { buildFileContent, ScriptMetadata, computeMetaHash, parseMetadata } from '../sync/metadata';
import type { ConfirmMutation } from '../sync/syncEngine';

function makeMockClient(overrides: Record<string, any> = {}) {
  const client = {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  (axios.create as any).mockReturnValue(client);
  return client;
}

const logger = { appendLine: vi.fn(), show: vi.fn(), verbose: vi.fn() };

function makeScriptMeta(overrides: Partial<ScriptMetadata> = {}): ScriptMetadata {
  const base: ScriptMetadata = {
    name: 'TestScript',
    description: '',
    shell: 'powershell',
    category: '',
    supported_platforms: [],
    args: [],
    env_vars: [],
    default_timeout: 90,
    run_as_user: false,
    syntax: '',
    favorite: false,
    hidden: false,
    code_hash: '',
    ids: {},
    ...overrides,
  };
  base.meta_hash = computeMetaHash(base);
  return base;
}

const API_URL = 'https://rmm-api.example.com/api/v3/';
const API_KEY = 'test-key-123';
const H = hashUrl(API_URL);

// ──────────────────────────────────────────────
// Group A: Push Counting Tests
// ──────────────────────────────────────────────
describe('pushToApi — push counting (Group A)', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'push-counting-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  // A1: New script without metadata
  it('A1: creates a new script without metadata — result.created=1', async () => {
    const code = 'Write-Output "new"';
    const filePath = path.join(syncFolder, 'scripts', 'NewRaw.ps1');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, code, 'utf-8');

    const client = makeMockClient();
    client.post.mockResolvedValue({ data: { id: 77 } });
    client.get.mockResolvedValueOnce({
      data: [{ id: 77, name: 'NewRaw', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
    });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.created).toBe(1);
    expect(result.pushed).toBe(0);
    expect(result.errors).toHaveLength(0);
    // Verify metadata was written locally
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('TRMM METADATA');
    expect(content).toContain(`${H}=77`);
  });

  // A2: New script WITH metadata (code_hash differs so it's detected as changed)
  it('A2: creates a new script with metadata — result.created=1', async () => {
    const code = 'Write-Output "with-meta"';
    const meta = makeScriptMeta({ name: 'WithMeta', code_hash: 'old-hash-that-differs', ids: {} });
    const filePath = buildScriptPath(syncFolder, 'WithMeta', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, meta), 'utf-8');

    const client = makeMockClient();
    client.post.mockResolvedValue({ data: { id: 42 } });
    client.get.mockResolvedValueOnce({
      data: [{ id: 42, name: 'WithMeta', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
    });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.created).toBe(1);
    expect(client.post).toHaveBeenCalled();
  });

  // A3: Unchanged push
  it('A3: unchanged files are counted as skipped', async () => {
    const code = 'Write-Output "same"';
    const meta = makeScriptMeta({ name: 'Same1', code_hash: sha256(code), ids: { [H]: 10 } });
    const filePath1 = buildScriptPath(syncFolder, 'Same1', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath1), { recursive: true });
    fs.writeFileSync(filePath1, buildFileContent(code, meta), 'utf-8');

    const code2 = 'Write-Output "same2"';
    const meta2 = makeScriptMeta({ name: 'Same2', code_hash: sha256(code2), ids: { [H]: 11 } });
    const filePath2 = buildScriptPath(syncFolder, 'Same2', '', 'powershell');
    fs.writeFileSync(filePath2, buildFileContent(code2, meta2), 'utf-8');

    const client = makeMockClient();
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    // Both files unchanged → result.skipped includes both
    expect(result.skipped).toBeGreaterThanOrEqual(2);
    expect(result.pushed).toBe(0);
    expect(result.created).toBe(0);
    expect(client.put).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  // A4: Modified code → updated
  it('A4: modified code results in result.pushed=1', async () => {
    const originalCode = 'Write-Output "old"';
    const newCode = 'Write-Output "new"';
    const meta = makeScriptMeta({ name: 'Changed', code_hash: sha256(originalCode), ids: { [H]: 20 } });
    const filePath = buildScriptPath(syncFolder, 'Changed', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(newCode, meta), 'utf-8');

    const client = makeMockClient();
    // Staleness check: download returns original code (same as local code_hash)
    client.get.mockResolvedValue({ data: { code: originalCode, filename: 'Changed.ps1' } });
    client.put.mockResolvedValue({ data: {} });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.pushed).toBe(1);
    expect(client.put).toHaveBeenCalled();
  });

  // A5: Modified metadata field → updated
  it('A5: metadata-only change results in result.pushed=1', async () => {
    const code = 'Write-Output "meta-change"';
    const originalMeta = makeScriptMeta({ name: 'MetaChange', description: 'old', code_hash: sha256(code), ids: { [H]: 30 } });
    const filePath = buildScriptPath(syncFolder, 'MetaChange', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    originalMeta.meta_hash = 'old-meta-hash'; // Force meta hash mismatch
    fs.writeFileSync(filePath, buildFileContent(code, originalMeta), 'utf-8');

    const client = makeMockClient();
    client.get.mockResolvedValue({ data: { code, filename: 'MetaChange.ps1' } });
    client.put.mockResolvedValue({ data: {} });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    // Note: code_hash matches stored hash, but meta_hash differs → should trigger update
    expect(result.pushed).toBe(1);
    expect(client.put).toHaveBeenCalled();
  });

  // A6: Mixed batch
  it('A6: mixed batch — 1 new, 1 updated, 1 unchanged counts correctly', async () => {
    // File 1: unchanged
    const code1 = 'Write-Output "unchanged"';
    const meta1 = makeScriptMeta({ name: 'BatchU', code_hash: sha256(code1), ids: { [H]: 50 } });
    const fp1 = buildScriptPath(syncFolder, 'BatchU', '', 'powershell');
    fs.mkdirSync(path.dirname(fp1), { recursive: true });
    fs.writeFileSync(fp1, buildFileContent(code1, meta1), 'utf-8');

    // File 2: modified
    const original2 = 'Write-Output "batch-old"';
    const new2 = 'Write-Output "batch-new"';
    const meta2 = makeScriptMeta({ name: 'BatchM', code_hash: sha256(original2), ids: { [H]: 51 } });
    const fp2 = buildScriptPath(syncFolder, 'BatchM', '', 'powershell');
    fs.writeFileSync(fp2, buildFileContent(new2, meta2), 'utf-8');

    // File 3: new (no id, stale code_hash so it's detected as changed)
    const code3 = 'Write-Output "batch-new-file"';
    const meta3 = makeScriptMeta({ name: 'BatchN', code_hash: 'old-hash-differs', ids: {} });
    const fp3 = buildScriptPath(syncFolder, 'BatchN', '', 'powershell');
    fs.writeFileSync(fp3, buildFileContent(code3, meta3), 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: { code: original2, filename: 'BatchM.ps1' } })
      .mockResolvedValueOnce({
        data: [{ id: 52, name: 'BatchN', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
      });
    client.put.mockResolvedValue({ data: {} });
    client.post.mockResolvedValue({ data: { id: 52 } });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.pushed).toBe(1);
    expect(result.created).toBe(1);
    // 1 unchanged file counted in skipped
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  // A7: Empty file excluded
  it('A7: empty file is excluded from push', async () => {
    // Normal file
    const code = 'Write-Output "normal"';
    const meta = makeScriptMeta({ name: 'Normal', code_hash: sha256(code), ids: { [H]: 60 } });
    const fpNormal = buildScriptPath(syncFolder, 'Normal', '', 'powershell');
    fs.mkdirSync(path.dirname(fpNormal), { recursive: true });
    fs.writeFileSync(fpNormal, buildFileContent(code, meta), 'utf-8');

    // Empty file
    const fpEmpty = path.join(syncFolder, 'scripts', 'Empty.ps1');
    fs.writeFileSync(fpEmpty, '', 'utf-8');

    const client = makeMockClient();
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    // Empty file is silently skipped; only the normal file is processed
    expect(result.pushed).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(client.post).not.toHaveBeenCalled();
  });

  // A8: Whitespace-only file excluded
  it('A8: whitespace-only file is excluded', async () => {
    const fpWhitespace = path.join(syncFolder, 'scripts', 'Whitespace.ps1');
    fs.mkdirSync(path.dirname(fpWhitespace), { recursive: true });
    fs.writeFileSync(fpWhitespace, '   \n  \t  \n  ', 'utf-8');

    const client = makeMockClient();
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(client.post).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
  });

  // A9: Scripts dir missing — should handle gracefully
  it('A9: missing scripts dir is handled without crash', async () => {
    const client = makeMockClient();
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });

  // A10: Local delete of synced script → API delete
  it('A10: deleting a synced script locally triggers API delete', async () => {
    // Create manifest referencing a script
    fs.mkdirSync(syncFolder, { recursive: true });
    fs.writeFileSync(
      path.join(syncFolder, '.trmm-manifest.json'),
      JSON.stringify({ version: 1, files: { 'scripts/ToDelete.ps1': { id: 99, type: 'script', shell: 'powershell' } } }),
      'utf-8',
    );

    const client = makeMockClient();
    client.delete.mockResolvedValue({});

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.deleted).toBe(1);
    // deleteScript sends DELETE to /scripts/{id}/
    expect(client.delete).toHaveBeenCalledWith('/scripts/99/');
  });

  // A11: Staleness skip
  it('A11: detects stale script and skips with staleStrategy=skip', async () => {
    const localCode = 'Write-Output "local"';
    const originalHash = sha256('Write-Output "original"');
    const meta = makeScriptMeta({ name: 'StaleCheck', code_hash: originalHash, ids: { [H]: 70 } });
    const filePath = buildScriptPath(syncFolder, 'StaleCheck', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(localCode, meta), 'utf-8');

    const client = makeMockClient();
    // API has different code → staleness detected
    client.get.mockResolvedValue({ data: { code: 'Write-Output "api-changed"', filename: 'StaleCheck.ps1' } });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, undefined, 'skip');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(client.put).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  // A12: Staleness overwrite
  it('A12: staleness overwrite pushes despite API change', async () => {
    const localCode = 'Write-Output "local"';
    const originalHash = sha256('Write-Output "original"');
    const meta = makeScriptMeta({ name: 'StaleOverwrite', code_hash: originalHash, ids: { [H]: 80 } });
    const filePath = buildScriptPath(syncFolder, 'StaleOverwrite', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(localCode, meta), 'utf-8');

    const client = makeMockClient();
    client.get.mockResolvedValue({ data: { code: 'Write-Output "api-changed"', filename: 'StaleOverwrite.ps1' } });
    client.put.mockResolvedValue({ data: {} });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, undefined, 'overwrite');
    expect(result.pushed).toBe(1);
    expect(client.put).toHaveBeenCalled();
    expect(result.errors).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// Group B: Paranoid Mode Tests
// ──────────────────────────────────────────────
describe('pushToApi — paranoid mode (Group B)', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'paranoid-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  // B1: Paranoid reject update
  it('B1: paranoid mode rejects update — skipped incremented', async () => {
    const code = 'Write-Output "modified"';
    const meta = makeScriptMeta({ name: 'ParanoidUpdate', code_hash: sha256('Write-Output "original"'), ids: { [H]: 90 } });
    const filePath = buildScriptPath(syncFolder, 'ParanoidUpdate', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, meta), 'utf-8');

    const confirmMutation: ConfirmMutation = async () => false;

    const client = makeMockClient();
    client.get.mockResolvedValue({ data: { code: 'Write-Output "original"', filename: 'ParanoidUpdate.ps1' } });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, confirmMutation, 'skip');
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.pushed).toBe(0);
    expect(client.put).not.toHaveBeenCalled();
  });

  // B2: Paranoid reject create
  it('B2: paranoid mode rejects create — skipped incremented', async () => {
    const code = 'Write-Output "new-paranoid"';
    const meta = makeScriptMeta({ name: 'ParanoidCreate', code_hash: sha256(code), ids: {} });
    const filePath = buildScriptPath(syncFolder, 'ParanoidCreate', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, meta), 'utf-8');

    const confirmMutation: ConfirmMutation = async () => false;

    const client = makeMockClient();
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, confirmMutation, 'skip');
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.created).toBe(0);
    expect(client.post).not.toHaveBeenCalled();
  });

  // B3: Paranoid reject delete
  it('B3: paranoid mode rejects delete — skipped incremented', async () => {
    fs.mkdirSync(syncFolder, { recursive: true });
    fs.writeFileSync(
      path.join(syncFolder, '.trmm-manifest.json'),
      JSON.stringify({ version: 1, files: { 'scripts/ParanoidDelete.ps1': { id: 95, type: 'script', shell: 'powershell' } } }),
      'utf-8',
    );

    const confirmMutation: ConfirmMutation = async () => false;

    const client = makeMockClient();
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, confirmMutation, 'skip');
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.deleted).toBe(0);
    expect(client.delete).not.toHaveBeenCalled();
  });

  // B4: Paranoid=2 — first auto-approved, rest rejected
  it('B4: paranoid=2 auto-approves first, rejects rest', async () => {
    // File 1: should be auto-approved (count=1 < paranoid=2)
    const code1 = 'Write-Output "first"';
    const meta1 = makeScriptMeta({ name: 'ParanoidFirst', code_hash: 'old-hash', ids: {} });
    const fp1 = buildScriptPath(syncFolder, 'ParanoidFirst', '', 'powershell');
    fs.mkdirSync(path.dirname(fp1), { recursive: true });
    fs.writeFileSync(fp1, buildFileContent(code1, meta1), 'utf-8');

    // File 2: should be rejected (count=2 >= paranoid=2)
    const code2 = 'Write-Output "second"';
    const meta2 = makeScriptMeta({ name: 'ParanoidSecond', code_hash: sha256(code2), ids: {} });
    const fp2 = buildScriptPath(syncFolder, 'ParanoidSecond', '', 'powershell');
    fs.writeFileSync(fp2, buildFileContent(code2, meta2), 'utf-8');

    // File 3: should be rejected (count=3 >= paranoid=2)
    const code3 = 'Write-Output "third"';
    const meta3 = makeScriptMeta({ name: 'ParanoidThird', code_hash: sha256(code3), ids: {} });
    const fp3 = buildScriptPath(syncFolder, 'ParanoidThird', '', 'powershell');
    fs.writeFileSync(fp3, buildFileContent(code3, meta3), 'utf-8');

    let callCount = 0;
    const confirmMutation: ConfirmMutation = async () => {
      callCount++;
      // paranoid=2: first call auto-approved (callCount=1 < 2), rest rejected
      return callCount < 2;
    };

    const client = makeMockClient();
    client.post.mockResolvedValue({ data: { id: 96 } });
    client.get.mockResolvedValueOnce({
      data: [{ id: 96, name: 'ParanoidFirst', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
    });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, confirmMutation, 'skip');
    expect(result.created).toBe(1);
    expect(result.skipped).toBeGreaterThanOrEqual(2);
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  // B5: Paranoid=0 (off) — no effect
  it('B5: paranoid=0 creates normally without skipping', async () => {
    const code = 'Write-Output "no-paranoid"';
    const meta = makeScriptMeta({ name: 'NoParanoid', code_hash: 'old-hash', ids: {} });
    const filePath = buildScriptPath(syncFolder, 'NoParanoid', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, meta), 'utf-8');

    const client = makeMockClient();
    client.post.mockResolvedValue({ data: { id: 97 } });
    client.get.mockResolvedValueOnce({
      data: [{ id: 97, name: 'NoParanoid', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
    });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
  });
});

// ──────────────────────────────────────────────
// Group C: Pull Counting Tests
// ──────────────────────────────────────────────
describe('pullFromApi — pull counting (Group C)', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'pull-counting-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  // C1: Pull fresh creates new files
  it('C1: fresh pull creates new files — result.pulled=1, result.created=1', async () => {
    const code = 'Write-Output "fresh"';
    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'FreshScript', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code, filename: 'FreshScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.pulled).toBe(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);

    const expectedPath = buildScriptPath(syncFolder, 'FreshScript', '', 'powershell');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  // C2: Pull unchanged — all skipped
  it('C2: unchanged pull — result.pulled=0, result.skipped>=1', async () => {
    const code = 'Write-Output "same"';
    const meta = makeScriptMeta({ name: 'SameScript', code_hash: sha256(code), ids: { [H]: 2 } });
    const expectedPath = buildScriptPath(syncFolder, 'SameScript', '', 'powershell');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, buildFileContent(code, meta), 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 2, name: 'SameScript', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code, filename: 'SameScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.pulled).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  // C3: Pull updated
  it('C3: API has newer code — result.pulled=1', async () => {
    const oldCode = 'Write-Output "old"';
    const newCode = 'Write-Output "new-on-api"';
    const meta = makeScriptMeta({ name: 'UpdatedScript', code_hash: sha256(oldCode), ids: { [H]: 3 } });
    const expectedPath = buildScriptPath(syncFolder, 'UpdatedScript', '', 'powershell');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, buildFileContent(oldCode, meta), 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 3, name: 'UpdatedScript', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code: newCode, filename: 'UpdatedScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.pulled).toBe(1);
    const content = fs.readFileSync(expectedPath, 'utf-8');
    expect(content).toContain(newCode);
  });

  // C4: Pull conflict with local strategy
  it('C4: conflict with local strategy keeps local content', async () => {
    const oldCode = 'Write-Output "local"';
    const apiCode = 'Write-Output "api"';
    // Create local file with hash that differs from local code_hash (simulating local edit)
    const originalHash = sha256('Write-Output "original"');
    const meta = makeScriptMeta({ name: 'ConflictScript', code_hash: originalHash, ids: { [H]: 4 } });
    const expectedPath = buildScriptPath(syncFolder, 'ConflictScript', '', 'powershell');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, buildFileContent(oldCode, meta), 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 4, name: 'ConflictScript', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code: apiCode, filename: 'ConflictScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'local');
    // local strategy kept local content
    const content = fs.readFileSync(expectedPath, 'utf-8');
    expect(content).toContain(oldCode);
  });

  // C5: Pull deletes file removed from API
  it('C5: files removed from API are deleted locally', async () => {
    const stalePath = path.join(syncFolder, 'scripts', 'Stale.ps1');
    fs.mkdirSync(path.dirname(stalePath), { recursive: true });
    fs.writeFileSync(stalePath, 'Write-Output "stale"', 'utf-8');
    fs.writeFileSync(
      path.join(syncFolder, '.trmm-manifest.json'),
      JSON.stringify({ version: 1, files: { 'scripts/Stale.ps1': { id: 999, type: 'script', shell: 'powershell' } } }),
      'utf-8',
    );

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(stalePath)).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Group D: Metadata / Git Tests
// ──────────────────────────────────────────────
describe('pushToApi — metadata and git (Group D)', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'git-metadata-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  // D1: Push commits metadata to git
  it('D1: push commits changes (commitSyncChanges called)', async () => {
    const code = 'Write-Output "git-test"';
    const meta = makeScriptMeta({ name: 'GitTest', code_hash: sha256(code), ids: { [H]: 100 } });
    const filePath = buildScriptPath(syncFolder, 'GitTest', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, meta), 'utf-8');

    const { commitSyncChanges } = await import('../sync/gitSync');

    const client = makeMockClient();
    client.get.mockResolvedValue({ data: { code, filename: 'GitTest.ps1' } });
    client.put.mockResolvedValue({ data: {} });

    await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(commitSyncChanges).toHaveBeenCalled();
  });

  // D2: Code change updates code_hash and meta_hash in local file
  it('D2: push updates code_hash and meta_hash locally after API update', async () => {
    const originalCode = 'Write-Output "original-git"';
    const newCode = 'Write-Output "modified-git"';
    const meta = makeScriptMeta({ name: 'HashTest', code_hash: sha256(originalCode), ids: { [H]: 110 } });
    const filePath = buildScriptPath(syncFolder, 'HashTest', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(newCode, meta), 'utf-8');

    const client = makeMockClient();
    client.get.mockResolvedValue({ data: { code: originalCode, filename: 'HashTest.ps1' } });
    client.put.mockResolvedValue({ data: {} });

    await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseMetadata(content, 'powershell');
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.code_hash).toBe(sha256(newCode));
    expect(parsed!.metadata.meta_hash).toBeDefined();
  });
});

// ──────────────────────────────────────────────
// Group G: Edge Cases
// ──────────────────────────────────────────────
describe('pushToApi — edge cases (Group G)', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'edge-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  // G1: Second push with no changes
  it('G1: second push with no changes — no API calls', async () => {
    const code = 'Write-Output "stable"';
    const meta = makeScriptMeta({ name: 'Stable', code_hash: sha256(code), ids: { [H]: 200 } });
    const filePath = buildScriptPath(syncFolder, 'Stable', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, meta), 'utf-8');

    const client = makeMockClient();
    // First push
    await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    // Reset call counts
    vi.clearAllMocks();
    client.get.mockResolvedValue({ data: [] });
    client.put.mockResolvedValue({ data: {} });
    client.post.mockResolvedValue({ data: {} });

    // Second push — nothing changed
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.pushed).toBe(0);
    expect(result.created).toBe(0);
    expect(client.put).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  // G2: Empty scripts directory
  it('G2: empty scripts dir — no crash, no API calls', async () => {
    fs.mkdirSync(path.join(syncFolder, 'scripts'), { recursive: true });

    const client = makeMockClient();
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.errors).toHaveLength(0);
    expect(client.put).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  // G5: Script file with spaces in filename
  it('G5: spaces in filename are handled', async () => {
    const code = 'Write-Output "spaces"';
    const filePath = path.join(syncFolder, 'scripts', 'my script file.ps1');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, code, 'utf-8');

    const client = makeMockClient();
    client.post.mockResolvedValue({ data: { id: 300 } });
    client.get.mockResolvedValueOnce({
      data: [{ id: 300, name: 'my script file', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
    });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');
    expect(result.created).toBe(1);
  });
});
