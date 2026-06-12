/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

vi.mock('axios');
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
      update: vi.fn(),
    })),
  },
  window: {
    showErrorMessage: vi.fn(),
  },
}));

import {
  writeReportFiles,
  readReportFiles,
  scanReportManifest,
  buildReportFolder,
  computeReportHash,
  pullReportsFromApi,
  pushReportsToApi,
  deleteReportFromApi,
  templateExtension,
  ReportMeta,
  ReportContent,
} from '../sync/reportSync';
import { getTmpDir } from './setup';
import { hashUrl } from '../sync/hash';

function mockAxiosClient(overrides: Record<string, any> = {}) {
  const mockClient = {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  (axios.create as any).mockReturnValue(mockClient);
  return mockClient;
}

function makeMeta(overrides: Partial<ReportMeta> = {}): ReportMeta {
  return {
    name: 'Test Report',
    type: 'html',
    depends_on: [],
    template_html: null,
    ids: { abc12345: 42 },
    code_hash: 'abc',
    ...overrides,
  };
}

function makeContent(overrides: Partial<ReportContent> = {}): ReportContent {
  return {
    template_md: '# Hello',
    template_css: 'body {}',
    template_variables: 'key: value',
    ...overrides,
  };
}

describe('computeReportHash', () => {
  it('returns a consistent hash for the same inputs', () => {
    const a = computeReportHash('md', 'css', 'vars');
    const b = computeReportHash('md', 'css', 'vars');
    expect(a).toBe(b);
  });

  it('changes when any input changes', () => {
    const base = computeReportHash('md', 'css', 'vars');
    expect(computeReportHash('md2', 'css', 'vars')).not.toBe(base);
    expect(computeReportHash('md', 'css2', 'vars')).not.toBe(base);
    expect(computeReportHash('md', 'css', 'vars2')).not.toBe(base);
  });

  it('returns a 64-char hex string', () => {
    const result = computeReportHash('md', 'css', 'vars');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('buildReportFolder', () => {
  it('builds path under reports with sanitized name', () => {
    const result = buildReportFolder('/base', 'My Report');
    expect(result).toBe(path.join('/base', 'reports', 'My Report'));
  });
});

describe('writeReportFiles and readReportFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(getTmpDir(), 'report-test');
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads back report files correctly', () => {
    const meta = makeMeta();
    const content = makeContent();

    writeReportFiles(tmpDir, meta, content);

    expect(fs.existsSync(path.join(tmpDir, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, `template${templateExtension('html')}`))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'style.css'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'variables.yaml'))).toBe(true);

    const parsed = readReportFiles(tmpDir);
    expect(parsed).not.toBeNull();
    expect(parsed!.meta.name).toBe('Test Report');
    expect(parsed!.content.template_md).toBe('# Hello');
    expect(parsed!.content.template_css).toBe('body {}');
    expect(parsed!.content.template_variables).toBe('key: value');
  });

  it('returns null when meta.json is missing', () => {
    const result = readReportFiles(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when meta.json is invalid JSON', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'meta.json'), 'not-json', 'utf-8');
    const result = readReportFiles(tmpDir);
    expect(result).toBeNull();
  });
});

describe('pullReportsFromApi', () => {
  const syncFolder = path.join(getTmpDir(), 'pull-reports');
  const logger = { appendLine: vi.fn(), show: vi.fn(), verbose: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  it('fetches reports and writes them to disk', async () => {
    const client = mockAxiosClient();
    client.get.mockResolvedValue({
      data: [
        { id: 1, name: 'Test Report', type: 'html', template_md: '# Hello', template_css: 'body {}', template_variables: 'k: v', template_html: null, depends_on: [] },
      ],
    });

    const result = await pullReportsFromApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', syncFolder, logger,
    );

    expect(result.pulled).toBe(1);
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);

    const metaPath = path.join(buildReportFolder(syncFolder, 'Test Report'), 'meta.json');
    expect(fs.existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.name).toBe('Test Report');
    expect(meta.ids).toHaveProperty(hashUrl('https://rmm-api.exemple.com/api/v3/'));
  });

  it('handles API fetch failure gracefully', async () => {
    const client = mockAxiosClient();
    client.get.mockRejectedValue(new Error('Network error'));

    const result = await pullReportsFromApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', syncFolder, logger,
    );

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.pulled).toBe(0);
  });

  it('skips unchanged reports', async () => {
    const reportFolder = buildReportFolder(syncFolder, 'Test Report');
    const meta = makeMeta({ name: 'Test Report', code_hash: computeReportHash('# Hello', 'body {}', 'k: v') });
    fs.mkdirSync(reportFolder, { recursive: true });
    fs.writeFileSync(path.join(reportFolder, 'meta.json'), JSON.stringify(meta), 'utf-8');
    fs.writeFileSync(path.join(reportFolder, `template${templateExtension('html')}`), '# Hello', 'utf-8');
    fs.writeFileSync(path.join(reportFolder, 'style.css'), 'body {}', 'utf-8');
    fs.writeFileSync(path.join(reportFolder, 'variables.yaml'), 'k: v', 'utf-8');

    const client = mockAxiosClient();
    client.get.mockResolvedValue({
      data: [
        { id: 1, name: 'Test Report', type: 'html', template_md: '# Hello', template_css: 'body {}', template_variables: 'k: v', template_html: null, depends_on: [] },
      ],
    });

    const result = await pullReportsFromApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', syncFolder, logger,
    );

    expect(result.skipped).toBe(1);
    expect(result.pulled).toBe(0);
  });
});

describe('pushReportsToApi', () => {
  const syncFolder = path.join(getTmpDir(), 'push-reports');
  const logger = { appendLine: vi.fn(), show: vi.fn(), verbose: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  it('creates new reports on API', async () => {
    const client = mockAxiosClient();
    client.post.mockResolvedValue({ data: { id: 99, name: 'New Report', type: 'html', template_md: '# New', template_css: '', template_variables: '', template_html: null, depends_on: [] } });

    const meta = makeMeta({ name: 'New Report', ids: {} });
    const reportFolder = buildReportFolder(syncFolder, 'New Report');
    fs.mkdirSync(reportFolder, { recursive: true });
    fs.writeFileSync(path.join(reportFolder, 'meta.json'), JSON.stringify(meta), 'utf-8');
    fs.writeFileSync(path.join(reportFolder, `template${templateExtension('html')}`), '# New', 'utf-8');
    fs.writeFileSync(path.join(reportFolder, 'style.css'), '', 'utf-8');
    fs.writeFileSync(path.join(reportFolder, 'variables.yaml'), '', 'utf-8');

    const result = await pushReportsToApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', syncFolder, logger,
    );

    expect(result.created).toBe(1);
  });

  it('updates existing reports on API', async () => {
    const client = mockAxiosClient();
    client.put.mockResolvedValue({ data: { id: 42, name: 'Existing', type: 'html', template_md: '# Updated', template_css: '', template_variables: '', template_html: null, depends_on: [] } });

    // Local content has changed (different from what's stored in code_hash)
    const localContent = '# Updated';
    const currentHash = computeReportHash(localContent, '', '');

    // API content matches the stored code_hash (not the current content)
    const apiContent = { template_md: '# Original', template_css: '', template_variables: '' };
    const storedHash = computeReportHash(apiContent.template_md, apiContent.template_css, apiContent.template_variables);
    client.get.mockResolvedValue({ data: { ...apiContent, id: 42, name: 'Existing', type: 'html', template_html: null, depends_on: [] } });

    const existingId = hashUrl('https://rmm-api.exemple.com/api/v3/');
    const meta = makeMeta({ name: 'Existing', ids: { [existingId]: 42 }, code_hash: storedHash });
    const reportFolder = buildReportFolder(syncFolder, 'Existing');
    fs.mkdirSync(reportFolder, { recursive: true });
    fs.writeFileSync(path.join(reportFolder, 'meta.json'), JSON.stringify(meta), 'utf-8');
    fs.writeFileSync(path.join(reportFolder, `template${templateExtension('html')}`), localContent, 'utf-8');
    fs.writeFileSync(path.join(reportFolder, 'style.css'), '', 'utf-8');
    fs.writeFileSync(path.join(reportFolder, 'variables.yaml'), '', 'utf-8');

    const result = await pushReportsToApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', syncFolder, logger,
    );

    expect(result.pushed).toBe(1);
  });

  it('skips reports when hash matches', async () => {
    const client = mockAxiosClient();
    const content = makeContent();
    const hash = computeReportHash(content.template_md, content.template_css, content.template_variables);
    const meta = makeMeta({ name: 'Unchanged', ids: { abc12345: 42 }, code_hash: hash });
    const reportFolder = buildReportFolder(syncFolder, 'Unchanged');
    fs.mkdirSync(reportFolder, { recursive: true });
    fs.writeFileSync(path.join(reportFolder, 'meta.json'), JSON.stringify(meta), 'utf-8');
    fs.writeFileSync(path.join(reportFolder, `template${templateExtension('html')}`), content.template_md, 'utf-8');
    fs.writeFileSync(path.join(reportFolder, 'style.css'), content.template_css, 'utf-8');
    fs.writeFileSync(path.join(reportFolder, 'variables.yaml'), content.template_variables, 'utf-8');

    const result = await pushReportsToApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', syncFolder, logger,
    );

    expect(result.skipped).toBe(1);
    expect(client.post).not.toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
  });

  it('returns empty result when no reports directory exists', async () => {
    const result = await pushReportsToApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', syncFolder, logger,
    );
    expect(result.pushed).toBe(0);
    expect(result.created).toBe(0);
  });
});

describe('deleteReportFromApi', () => {
  const logger = { appendLine: vi.fn(), show: vi.fn(), verbose: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes report on API and returns true', async () => {
    const client = mockAxiosClient();
    client.delete.mockResolvedValue({});
    const result = await deleteReportFromApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', 42, logger,
    );
    expect(result).toBe(true);
  });

  it('returns false on API failure', async () => {
    const client = mockAxiosClient();
    client.delete.mockRejectedValue(new Error('Not found'));
    const result = await deleteReportFromApi(
      'https://rmm-api.exemple.com/api/v3/', 'key', 999, logger,
    );
    expect(result).toBe(false);
  });
});

describe('scanReportManifest', () => {
  const syncFolder = path.join(getTmpDir(), 'scan-manifest');

  beforeEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(syncFolder)) fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  it('returns empty manifest when reports dir is missing', () => {
    const manifest = scanReportManifest(syncFolder, 'https://rmm-api.exemple.com/api/v3/');
    expect(manifest).toEqual({});
  });

  it('scans report folders and returns manifest entries', () => {
    const apiUrl = 'https://rmm-api.exemple.com/api/v3/';
    const h = hashUrl(apiUrl);
    const reportFolder = buildReportFolder(syncFolder, 'My Report');
    const meta = makeMeta({ name: 'My Report', ids: { [h]: 42 } });
    const content = makeContent();
    writeReportFiles(reportFolder, meta, content);

    const manifest = scanReportManifest(syncFolder, apiUrl);
    const expectedRelPath = path.join('reports', 'My Report', 'meta.json');
    expect(manifest[expectedRelPath]).toEqual({ id: 42, folder: 'My Report' });
  });

  it('skips folders without valid meta.json', () => {
    fs.mkdirSync(path.join(syncFolder, 'reports', 'Broken'), { recursive: true });
    const manifest = scanReportManifest(syncFolder, 'https://rmm-api.exemple.com/api/v3/');
    expect(manifest).toEqual({});
  });
});
