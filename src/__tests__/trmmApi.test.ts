/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

import { TrmmApi, ReportPayload } from '../api/trmmApi';

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
      const payload: ReportPayload = {
        name: 'Test',
        template_md: '# Hello',
        template_css: '',
        type: 'html',
        template_variables: '',
        depends_on: [],
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
