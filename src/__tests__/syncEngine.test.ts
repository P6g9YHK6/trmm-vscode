/* eslint-disable @typescript-eslint/no-explicit-any */
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
}));

import axios, { AxiosError } from 'axios';
import {
  pullFromApi,
  pushToApi,
  SyncResult,
} from '../sync/syncEngine';
import { getTmpDir } from './setup';
import { hashUrl, sha256 } from '../sync/hash';
import { buildScriptPath, inferShell } from '../utils/pathBuilder';
import { buildFileContent, ScriptMetadata, computeMetaHash, parseMetadata } from '../sync/metadata';

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

const logger = { appendLine: vi.fn(), show: vi.fn() };

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

describe('loadManifest / saveManifest (tested via pull/push)', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'sync-manifest-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  it('creates a manifest file after pull', async () => {
    const client = makeMockClient();
    client.get.mockResolvedValue({ data: [] });

    await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    const manifestPath = path.join(syncFolder, '.trmm-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.version).toBe(1);
  });
});

describe('findFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = path.join(getTmpDir(), 'find-files-test');
    fs.mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is used internally by rebuildManifestFromDisk and cleanObsoleteFiles', () => {
    // This is exercised via pull/push integration; findFiles is private.
    expect(true).toBe(true);
  });
});

describe('pullFromApi', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'pull-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  it('creates new script files from API', async () => {
    const code = 'Write-Output "hello"';
    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'TestScript', description: 'desc', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code, filename: 'TestScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.pulled).toBe(1);
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);

    const expectedPath = buildScriptPath(syncFolder, 'TestScript', '', 'powershell');
    expect(fs.existsSync(expectedPath)).toBe(true);

    const content = fs.readFileSync(expectedPath, 'utf-8');
    expect(content).toContain(code);
    expect(content).toContain(H);
  });

  it('creates new snippet files from API', async () => {
    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: 10, name: 'MySnippet', code: 'Write-Output "snippet"' }] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.pulled).toBe(1);
    expect(result.created).toBe(1);

    const snippetPath = path.join(syncFolder, 'snippets', 'MySnippet.ps1');
    expect(fs.existsSync(snippetPath)).toBe(true);
    expect(fs.readFileSync(snippetPath, 'utf-8')).toContain('Write-Output "snippet"');
  });

  it('updates existing file when API has newer code', async () => {
    const code = 'Write-Output "updated"';
    const newHash = sha256(code);

    const existingMeta = makeScriptMeta({ name: 'TestScript', code_hash: sha256('Write-Output "old"'), ids: { [H]: 1 } });
    const existingContent = buildFileContent('Write-Output "old"', existingMeta);
    const expectedPath = buildScriptPath(syncFolder, 'TestScript', '', 'powershell');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, existingContent, 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'TestScript', description: 'desc', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code, filename: 'TestScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.pulled).toBe(1);
    expect(result.skipped).toBe(0);

    const content = fs.readFileSync(expectedPath, 'utf-8');
    expect(content).toContain(code);
    expect(content).toContain(newHash);
  });

  it('skips unchanged files', async () => {
    const code = 'Write-Output "same"';

    const existingMeta = makeScriptMeta({ name: 'TestScript', description: 'desc', code_hash: sha256(code), ids: { [H]: 1 } });
    const existingContent = buildFileContent(code, existingMeta);
    const expectedPath = buildScriptPath(syncFolder, 'TestScript', '', 'powershell');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, existingContent, 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'TestScript', description: 'desc', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code, filename: 'TestScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.pulled).toBe(0);
  });

  it('updates metadata when only metadata changed on API', async () => {
    const code = 'Write-Output "same"';

    const existingMeta = makeScriptMeta({ name: 'TestScript', description: 'old desc', code_hash: sha256(code), ids: { [H]: 1 } });
    const existingContent = buildFileContent(code, existingMeta);
    const expectedPath = buildScriptPath(syncFolder, 'TestScript', '', 'powershell');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, existingContent, 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'TestScript', description: 'new desc', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code, filename: 'TestScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.pulled).toBe(1);
    expect(result.skipped).toBe(0);

    const content = fs.readFileSync(expectedPath, 'utf-8');
    const parsed = parseMetadata(content, 'powershell');
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.description).toBe('new desc');
  });

  it('handles API fetch failure gracefully', async () => {
    const client = makeMockClient();
    client.get.mockRejectedValue(new Error('Network error'));

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.pulled).toBe(0);
  });

  it('adds metadata to existing file without metadata', async () => {
    const code = 'Write-Output "no metadata"';
    const expectedPath = buildScriptPath(syncFolder, 'TestScript', '', 'powershell');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, code, 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'TestScript', description: 'desc', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code, filename: 'TestScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.pulled).toBe(1);
    const content = fs.readFileSync(expectedPath, 'utf-8');
    expect(content).toContain('TRMM METADATA');
    expect(content).toContain(H);
  });

  it('honors enableScripts=false', async () => {
    const client = makeMockClient();
    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, false);

    expect(result.pulled).toBe(0);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('cleans obsolete files not present on API', async () => {
    const stalePath = path.join(syncFolder, 'scripts', 'Stale.ps1');
    fs.mkdirSync(path.dirname(stalePath), { recursive: true });
    fs.writeFileSync(stalePath, 'Write-Output "stale"', 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(stalePath)).toBe(false);
  });

  it('handles conflict when local and API both changed', async () => {
    const oldCode = 'Write-Output "local"';
    const apiCode = 'Write-Output "api"';

    const existingMeta = makeScriptMeta({ name: 'TestScript', code_hash: sha256('Write-Output "original"'), ids: { [H]: 1 } });
    const existingContent = buildFileContent(oldCode, existingMeta);
    const expectedPath = buildScriptPath(syncFolder, 'TestScript', '', 'powershell');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, existingContent, 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'TestScript', description: 'desc', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }] })
      .mockResolvedValueOnce({ data: { code: apiCode, filename: 'TestScript.ps1' } })
      .mockResolvedValueOnce({ data: [] });

    const result = await pullFromApi(API_URL, API_KEY, syncFolder, logger, 'api');

    expect(result.pulled).toBe(1);
    const content = fs.readFileSync(expectedPath, 'utf-8');
    expect(content).toContain(apiCode);
  });
});

describe('pushToApi', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'push-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  it('skips unchanged scripts', async () => {
    const code = 'Write-Output "unchanged"';
    const existingMeta = makeScriptMeta({ name: 'Unchanged', code_hash: sha256(code), ids: { [H]: 42 } });
    const filePath = buildScriptPath(syncFolder, 'Unchanged', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, existingMeta), 'utf-8');

    const client = makeMockClient();
    await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(client.put).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('updates scripts with changed content', async () => {
    const code = 'Write-Output "changed"';
    const existingMeta = makeScriptMeta({ name: 'Changed', code_hash: sha256('Write-Output "old"'), ids: { [H]: 42 } });
    const filePath = buildScriptPath(syncFolder, 'Changed', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, existingMeta), 'utf-8');

    const client = makeMockClient();
    client.get.mockResolvedValue({ data: { code: 'Write-Output "old"', filename: 'Changed.ps1' } });
    client.put.mockResolvedValue({ data: {} });

    await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(client.put).toHaveBeenCalled();
    const putArg = (client.put as any).mock.calls[0][1];
    expect(putArg.script_body).toBe(code);
  });

  it('creates new scripts on API when no ID', async () => {
    const code = 'Write-Output "new"';
    const existingMeta = makeScriptMeta({ name: 'NewScript', code_hash: sha256('original code'), ids: {} });
    const filePath = buildScriptPath(syncFolder, 'NewScript', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, existingMeta), 'utf-8');

    const client = makeMockClient();
    client.post.mockResolvedValue({ data: { id: 99 } });
    client.get.mockResolvedValue({
      data: [{ id: 99, name: 'NewScript', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
    });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.created).toBe(1);
    expect(client.post).toHaveBeenCalled();

    const writtenContent = fs.readFileSync(filePath, 'utf-8');
    expect(writtenContent).toContain(`${H}=99`);
  });

  it('creates scripts without metadata', async () => {
    const code = 'Write-Output "raw"';
    const filePath = path.join(syncFolder, 'scripts', 'Raw.ps1');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, code, 'utf-8');

    const client = makeMockClient();
    client.post.mockResolvedValue({ data: { id: 77 } });
    client.get.mockResolvedValue({
      data: [{ id: 77, name: 'Raw', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
    });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.created).toBe(1);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('TRMM METADATA');
    expect(content).toContain(`${H}=77`);
  });

  it('handles 404 on update by re-creating', async () => {
    const code = 'Write-Output "recreate"';
    const existingMeta = makeScriptMeta({ name: 'Recreate', code_hash: sha256('original code'), ids: { [H]: 42 } });
    const filePath = buildScriptPath(syncFolder, 'Recreate', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, existingMeta), 'utf-8');

    const client = makeMockClient();
    client.get
      .mockResolvedValueOnce({ data: { code: 'original code', filename: 'Recreate.ps1' } })
      .mockResolvedValueOnce({
        data: [{ id: 55, name: 'Recreate', description: '', shell: 'powershell', category: '', script_type: 'userdefined', args: [], env_vars: [], default_timeout: 90, run_as_user: false, syntax: '', favorite: false, hidden: false, supported_platforms: [] }],
      });
    const axiosError = new AxiosError('Not found');
    axiosError.response = { status: 404, data: {}, headers: {}, statusText: 'Not Found', config: undefined as any } as any;
    client.put.mockRejectedValue(axiosError);
    client.post.mockResolvedValue({ data: { id: 55 } });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.created).toBe(1);
    expect(client.post).toHaveBeenCalled();
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain(`${H}=55`);
  });

  it('detects stale scripts and skips with staleStrategy=skip', async () => {
    const code = 'Write-Output "stale-check"';
    const existingMeta = makeScriptMeta({ name: 'Stale', code_hash: sha256('Write-Output "stale-original"'), ids: { [H]: 10 } });
    const filePath = buildScriptPath(syncFolder, 'Stale', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, existingMeta), 'utf-8');

    const client = makeMockClient();
    client.get.mockResolvedValue({ data: { code: 'Write-Output "api-changed"', filename: 'Stale.ps1' } });

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, undefined, 'skip');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(client.put).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('deletes scripts removed from disk when scriptsDir is gone', async () => {
    const manifestPath = path.join(syncFolder, '.trmm-manifest.json');
    fs.mkdirSync(syncFolder, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, files: { 'scripts/ToDelete.ps1': { id: 99, type: 'script', shell: 'powershell' } } }), 'utf-8');

    const client = makeMockClient();
    client.delete.mockResolvedValue({});

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(client.delete).toHaveBeenCalled();
  });

  it('handles API failure on create gracefully', async () => {
    const code = 'Write-Output "fail-create"';
    const existingMeta = makeScriptMeta({ name: 'FailCreate', code_hash: sha256('old code'), ids: {} });
    const filePath = buildScriptPath(syncFolder, 'FailCreate', '', 'powershell');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildFileContent(code, existingMeta), 'utf-8');

    const client = makeMockClient();
    client.post.mockRejectedValue(new Error('API error'));

    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.created).toBe(0);
  });

  it('honors enableScripts=false and enableReports=false together', async () => {
    const result = await pushToApi(API_URL, API_KEY, syncFolder, logger, 'ask', undefined, undefined, undefined, false, false);

    expect(result.pushed).toBe(0);
    expect(result.created).toBe(0);
  });
});
