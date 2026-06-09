import axios, { AxiosInstance } from 'axios';

export interface Agent {
  agent_id: string;
  hostname: string;
  plat?: string;
  version?: string;
}

export interface ScriptHeader {
  id: number;
  name: string;
  description: string;
  shell: string;
  category: string;
  script_type: string;
  args: string[];
  env_vars: string[];
  default_timeout: number;
  run_as_user: boolean;
  syntax: string;
  favorite: boolean;
  hidden: boolean;
  supported_platforms: string[];
}

export interface ScriptDownload {
  code: string;
  filename: string;
}

export interface ScriptPayload {
  name: string;
  description: string;
  shell: string;
  category: string;
  script_body: string;
  args: string[];
  env_vars: string[];
  default_timeout: number;
  run_as_user: boolean;
  syntax: string;
  favorite: boolean;
  hidden: boolean;
  supported_platforms: string[];
}

export interface SnippetHeader {
  id: number;
  name: string;
  code: string;
}

export interface TestResult {
  stdout: string;
  stderr: string;
  returncode: number;
  execution_time: number;
}

export class TrmmApi {
  readonly apiUrl: string;
  private client: AxiosInstance;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.client = axios.create({
      baseURL: apiUrl,
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async fetchAgents(): Promise<Agent[]> {
    const { data } = await this.client.get('/agents/', { params: { detail: false } });
    return data;
  }

  async fetchScripts(): Promise<ScriptHeader[]> {
    const response = await this.client.get('/scripts/', {
      params: { showHiddenScripts: true },
    });
    const data = response.data;
    if (data === null || data === undefined) {
      throw new Error(`fetchScripts: API returned ${data === null ? 'null' : 'undefined'}. Status: ${response.status}`);
    }
    let list: unknown[];
    if (Array.isArray(data)) {
      list = data;
    } else if (data?.data && Array.isArray(data.data)) {
      list = data.data;
    } else if (data?.results && Array.isArray(data.results)) {
      list = data.results;
    } else if (data?.scripts && Array.isArray(data.scripts)) {
      list = data.scripts;
    } else {
      const dataType = typeof data;
      const dataKeys = data && typeof data === 'object' ? Object.keys(data).join(', ') : 'none';
      throw new Error(
        `fetchScripts: unexpected response format. Type: ${dataType}, Keys: ${dataKeys}, Status: ${response.status}`
      );
    }
    return list.filter((s): s is ScriptHeader => (s as Record<string, unknown>)?.script_type === 'userdefined');
  }

  async fetchSnippets(): Promise<SnippetHeader[]> {
    const response = await this.client.get('/scripts/snippets/');
    const data = response.data;
    if (data === null || data === undefined) {
      throw new Error('fetchSnippets: API returned null/undefined');
    }
    if (!Array.isArray(data)) {
      const dataType = typeof data;
      const dataKeys = data && typeof data === 'object' ? Object.keys(data).join(', ') : 'none';
      throw new Error(`fetchSnippets: unexpected format. Type: ${dataType}, Keys: ${dataKeys}`);
    }
    return data;
  }

  async downloadScript(id: number): Promise<ScriptDownload> {
    const response = await this.client.get(`/scripts/${id}/download/`, {
      params: { with_snippets: false },
    });
    const data = response.data;
    if (!data || (typeof data.code !== 'string' && typeof data.script_body !== 'string')) {
      const snippet = JSON.stringify(data).slice(0, 300);
      throw new Error(`downloadScript #${id}: unexpected format. Response: ${snippet}`);
    }
    return {
      code: data.code || data.script_body || '',
      filename: data.filename || `${id}`,
    };
  }

  async createScript(payload: ScriptPayload): Promise<{ id: number }> {
    const { data } = await this.client.post('/scripts/', payload);
    return data;
  }

  async updateScript(id: number, payload: Partial<ScriptPayload>): Promise<void> {
    await this.client.put(`/scripts/${id}/`, payload);
  }

  async deleteScript(id: number): Promise<void> {
    await this.client.delete(`/scripts/${id}/`);
  }

  async testOnServer(payload: {
    code: string;
    timeout: number;
    args: string[];
    shell: string;
    run_as_user: boolean;
    env_vars: string[];
  }): Promise<TestResult> {
    const { data } = await this.client.post('/scripts/server/test/', payload);
    return data;
  }

  async testOnAgent(agentId: string, payload: {
    code: string;
    timeout: number;
    args: string[];
    shell: string;
    run_as_user: boolean;
    env_vars: string[];
  }): Promise<TestResult> {
    const { data } = await this.client.post(`/scripts/${agentId}/test/`, payload);
    return data;
  }

  async runScriptOnAgent(agentId: string, payload: {
    script: number;
    args: string[];
    output: string;
    run_as_user: boolean;
    env_vars: string[];
    timeout: number;
  }): Promise<unknown> {
    const { data } = await this.client.post(`/agents/${agentId}/runscript/`, payload);
    return data;
  }

  // Snippet endpoints
  async createSnippet(payload: { name: string; code: string }): Promise<{ id: number }> {
    const { data } = await this.client.post('/scripts/snippets/', payload);
    return data;
  }

  async updateSnippet(id: number, payload: { name: string; code: string }): Promise<void> {
    await this.client.put(`/scripts/snippets/${id}/`, payload);
  }

  async deleteSnippet(id: number): Promise<void> {
    await this.client.delete(`/scripts/snippets/${id}/`);
  }
}
