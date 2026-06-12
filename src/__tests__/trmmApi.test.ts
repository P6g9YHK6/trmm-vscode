/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { TrmmApi, ScriptPayload, SnippetHeader } from '../api/trmmApi';

function makeMockClient() {
  return {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({}),
  };
}

describe('TrmmApi', () => {
  const apiUrl = 'https://rmm-api.exemple.com/api/v3/';
  const apiKey = 'test-key-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchAgents', () => {
    it('returns agents from a flat array', async () => {
      const mockClient = makeMockClient();
      const agents = [{ agent_id: 'a1', hostname: 'host1' }, { agent_id: 'a2', hostname: 'host2' }];
      mockClient.get.mockResolvedValue({ data: agents });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.fetchAgents();
      expect(result).toEqual(agents);
      expect(mockClient.get).toHaveBeenCalledWith('/agents/');
    });

    it('returns agents from data.data', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: { data: [{ agent_id: 'a1', hostname: 'host1' }] } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.fetchAgents();
      expect(result).toHaveLength(1);
    });

    it('throws on null response', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: null });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await expect(api.fetchAgents()).rejects.toThrow('fetchAgents: API returned null');
    });

    it('throws on unexpected format', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: 'string' });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await expect(api.fetchAgents()).rejects.toThrow('unexpected response format');
    });
  });

  describe('fetchScripts', () => {
    it('returns userdefined scripts from flat array', async () => {
      const mockClient = makeMockClient();
      const scripts = [
        { id: 1, name: 'S1', script_type: 'userdefined' },
        { id: 2, name: 'S2', script_type: 'builtin' },
      ];
      mockClient.get.mockResolvedValue({ data: scripts });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.fetchScripts();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('S1');
    });

    it('passes showHiddenScripts=true param', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: [] });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await api.fetchScripts();
      expect(mockClient.get).toHaveBeenCalledWith('/scripts/', { params: { showHiddenScripts: true } });
    });

    it('throws on null response', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: null });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await expect(api.fetchScripts()).rejects.toThrow('fetchScripts: API returned null');
    });
  });

  describe('fetchSnippets', () => {
    it('returns array of snippets', async () => {
      const mockClient = makeMockClient();
      const snippets: SnippetHeader[] = [{ id: 1, name: 'SN1', code: 'echo hi' }];
      mockClient.get.mockResolvedValue({ data: snippets });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.fetchSnippets();
      expect(result).toEqual(snippets);
      expect(mockClient.get).toHaveBeenCalledWith('/scripts/snippets/');
    });

    it('throws on non-array response', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: { not: 'array' } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await expect(api.fetchSnippets()).rejects.toThrow('unexpected format');
    });
  });

  describe('downloadScript', () => {
    it('returns code and filename from response', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: { code: 'Write-Host hi', filename: 'test.ps1' } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.downloadScript(42);
      expect(result).toEqual({ code: 'Write-Host hi', filename: 'test.ps1' });
      expect(mockClient.get).toHaveBeenCalledWith('/scripts/42/download/', { params: { with_snippets: false } });
    });

    it('falls back to script_body', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: { script_body: 'echo hello' } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.downloadScript(1);
      expect(result.code).toBe('echo hello');
    });

    it('throws on unexpected format', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: { foo: 'bar' } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await expect(api.downloadScript(1)).rejects.toThrow('downloadScript #1: unexpected format');
    });
  });

  describe('createScript', () => {
    it('POSTs and finds the created script by name+shell', async () => {
      const mockClient = makeMockClient();
      const payload: ScriptPayload = {
        name: 'NewScript', description: '', shell: 'powershell', category: '',
        script_body: 'Write-Host hi', args: [], env_vars: [],
        default_timeout: 90, run_as_user: false, syntax: '',
        favorite: false, hidden: false, supported_platforms: [],
      };
      mockClient.post.mockResolvedValue({ data: {} });
      mockClient.get.mockResolvedValue({
        data: [
          { id: 1, name: 'Other', shell: 'python', script_type: 'userdefined' },
          { id: 99, name: 'NewScript', shell: 'powershell', script_type: 'userdefined' },
        ],
      });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.createScript(payload);
      expect(result).toEqual({ id: 99 });
      expect(mockClient.post).toHaveBeenCalledWith('/scripts/', payload);
    });

    it('throws when script not found after create', async () => {
      const mockClient = makeMockClient();
      mockClient.post.mockResolvedValue({ data: {} });
      mockClient.get.mockResolvedValue({ data: [] });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await expect(api.createScript({ name: 'X' } as any)).rejects.toThrow('created but not found');
    });
  });

  describe('updateScript', () => {
    it('PUTs to /scripts/{id}/', async () => {
      const mockClient = makeMockClient();
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await api.updateScript(42, { name: 'Renamed' });
      expect(mockClient.put).toHaveBeenCalledWith('/scripts/42/', { name: 'Renamed' });
    });
  });

  describe('deleteScript', () => {
    it('DELETEs /scripts/{id}/', async () => {
      const mockClient = makeMockClient();
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await api.deleteScript(7);
      expect(mockClient.delete).toHaveBeenCalledWith('/scripts/7/');
    });
  });

  describe('testOnServer', () => {
    it('POSTs and returns TestResult', async () => {
      const mockClient = makeMockClient();
      mockClient.post.mockResolvedValue({ data: { stdout: 'ok', returncode: 0, execution_time: 1.2 } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.testOnServer({ code: 'echo hi', timeout: 30, args: [], shell: 'shell', run_as_user: false, env_vars: [] });
      expect(result.stdout).toBe('ok');
      expect(result.returncode).toBe(0);
      expect(mockClient.post).toHaveBeenCalledWith('/scripts/server/test/', expect.any(Object));
    });
  });

  describe('testOnAgent', () => {
    it('POSTs to /scripts/{agentId}/test/', async () => {
      const mockClient = makeMockClient();
      mockClient.post.mockResolvedValue({ data: { stdout: '', returncode: 0, execution_time: 0 } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.testOnAgent('agent-1', { code: 'echo', timeout: 30, args: [], shell: 'shell', run_as_user: false, env_vars: [] });
      expect(result.returncode).toBe(0);
      expect(mockClient.post).toHaveBeenCalledWith('/scripts/agent-1/test/', expect.any(Object));
    });

    it('falls back returncode from retcode', async () => {
      const mockClient = makeMockClient();
      mockClient.post.mockResolvedValue({ data: { retcode: 1, execution_time: 0 } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.testOnAgent('a1', { code: 'x', timeout: 10, args: [], shell: 'shell', run_as_user: false, env_vars: [] });
      expect(result.returncode).toBe(1);
    });
  });

  describe('runScriptOnAgent', () => {
    it('POSTs to /agents/{agentId}/runscript/', async () => {
      const mockClient = makeMockClient();
      mockClient.post.mockResolvedValue({ data: { task_id: 123 } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.runScriptOnAgent('a1', { script: 5, args: [], output: 'tail', run_as_user: false, env_vars: [], timeout: 60 });
      expect(result).toEqual({ task_id: 123 });
      expect(mockClient.post).toHaveBeenCalledWith('/agents/a1/runscript/', expect.any(Object));
    });
  });

  describe('createSnippet', () => {
    it('POSTs to /scripts/snippets/', async () => {
      const mockClient = makeMockClient();
      mockClient.post.mockResolvedValue({ data: { id: 10 } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.createSnippet({ name: 'SN', code: 'echo' });
      expect(result).toEqual({ id: 10 });
      expect(mockClient.post).toHaveBeenCalledWith('/scripts/snippets/', { name: 'SN', code: 'echo' });
    });
  });

  describe('updateSnippet', () => {
    it('PUTs to /scripts/snippets/{id}/', async () => {
      const mockClient = makeMockClient();
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await api.updateSnippet(5, { name: 'SN', code: 'new' });
      expect(mockClient.put).toHaveBeenCalledWith('/scripts/snippets/5/', { name: 'SN', code: 'new' });
    });
  });

  describe('deleteSnippet', () => {
    it('DELETEs /scripts/snippets/{id}/', async () => {
      const mockClient = makeMockClient();
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await api.deleteSnippet(3);
      expect(mockClient.delete).toHaveBeenCalledWith('/scripts/snippets/3/');
    });
  });

  describe('getReportTemplate', () => {
    it('GETs /reporting/templates/{id}/', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: { id: 7, name: 'RT' } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.getReportTemplate(7);
      expect(result).toEqual({ id: 7, name: 'RT' });
      expect(mockClient.get).toHaveBeenCalledWith('/reporting/templates/7/');
    });
  });

  describe('fetchReportTemplates', () => {
    it('GETs /reporting/templates/ and returns data', async () => {
      const mockClient = makeMockClient();
      mockClient.get.mockResolvedValue({ data: [{ id: 1, name: 'R1' }] });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.fetchReportTemplates();
      expect(result).toEqual([{ id: 1, name: 'R1' }]);
      expect(mockClient.get).toHaveBeenCalledWith('/reporting/templates/');
    });
  });

  describe('createReportTemplate', () => {
    it('POSTs to /reporting/templates/ with payload', async () => {
      const payload = {
        name: 'Test', template_md: '# Hello', template_css: '',
        type: 'html' as const, template_variables: '', depends_on: [],
      };
      const mockClient = makeMockClient();
      mockClient.post.mockResolvedValue({ data: { id: 99, ...payload } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.createReportTemplate(payload);
      expect(result).toEqual({ id: 99, ...payload });
      expect(mockClient.post).toHaveBeenCalledWith('/reporting/templates/', payload);
    });
  });

  describe('updateReportTemplate', () => {
    it('PUTs to /reporting/templates/{id}/ with partial payload', async () => {
      const payload = { name: 'Updated' };
      const mockClient = makeMockClient();
      mockClient.put.mockResolvedValue({ data: { id: 42, name: 'Updated' } });
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      const result = await api.updateReportTemplate(42, payload);
      expect(result).toEqual({ id: 42, name: 'Updated' });
      expect(mockClient.put).toHaveBeenCalledWith('/reporting/templates/42/', payload);
    });
  });

  describe('deleteReportTemplate', () => {
    it('DELETEs /reporting/templates/{id}/', async () => {
      const mockClient = makeMockClient();
      (axios.create as any).mockReturnValue(mockClient);

      const api = new TrmmApi(apiUrl, apiKey);
      await api.deleteReportTemplate(42);
      expect(mockClient.delete).toHaveBeenCalledWith('/reporting/templates/42/');
    });
  });
});
