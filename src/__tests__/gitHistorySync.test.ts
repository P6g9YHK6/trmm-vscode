import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../utils/config', () => ({
  getConfig: vi.fn(() => ({ apiUrl: '', apiKey: '', syncFolder: '' })),
}));
vi.mock('axios', () => ({ default: { create: vi.fn() } }));
vi.mock('../logger', () => ({ Logger: vi.fn(), toErrorMessage: vi.fn(() => 'err') }));

import { validateExtractedPaths } from '../sync/gitHistorySync';
import { getTmpDir } from './setup';

describe('validateExtractedPaths', () => {
  it('passes valid nested directory structure', () => {
    const root = path.join(getTmpDir(), 'valid-extract');
    fs.mkdirSync(path.join(root, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(root, 'file.txt'), 'a');
    fs.writeFileSync(path.join(root, 'subdir', 'nested.txt'), 'b');

    const removed = validateExtractedPaths(root, root);
    expect(removed).toBe(0);
    expect(fs.existsSync(path.join(root, 'file.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'subdir', 'nested.txt'))).toBe(true);
  });

  it('removes entries that escape base via ../', () => {
    // Simulate: tmpDir = root/extractDir, archive put a file outside via ../
    const root = path.join(getTmpDir(), 'escape-test');
    const extractDir = path.join(root, 'tmp');
    fs.mkdirSync(extractDir, { recursive: true });
    // A file placed outside extractDir (simulating ../outside.txt in archive)
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'evil');

    const removed = validateExtractedPaths(root, extractDir);
    expect(removed).toBe(1);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('calls onBadEntry for each removed entry', () => {
    const root = path.join(getTmpDir(), 'callback-test');
    const extractDir = path.join(root, 'tmp');
    fs.mkdirSync(extractDir, { recursive: true });
    const outside = path.join(root, 'malicious.txt');
    fs.writeFileSync(outside, 'bad');

    const badEntries: string[] = [];
    const removed = validateExtractedPaths(root, extractDir, (entry) => {
      badEntries.push(entry);
    });

    expect(removed).toBe(1);
    expect(badEntries.length).toBe(1);
    expect(badEntries[0]).toContain('malicious.txt');
  });

  it('handles empty directory', () => {
    const root = path.join(getTmpDir(), 'empty-dir');
    fs.mkdirSync(root, { recursive: true });
    const removed = validateExtractedPaths(root, root);
    expect(removed).toBe(0);
  });

  it('allows files in root of baseDir', () => {
    const root = path.join(getTmpDir(), 'root-files');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.writeFileSync(path.join(root, 'b.txt'), 'b');

    const removed = validateExtractedPaths(root, root);
    expect(removed).toBe(0);
  });
});
