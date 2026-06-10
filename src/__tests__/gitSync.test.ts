import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ensureGitRepo, commitSyncChanges } from '../sync/gitSync';
import { getTmpDir } from './setup';

vi.mock('child_process');

describe('ensureGitRepo', () => {
  let syncFolder: string;

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'git-sync-test');
    fs.mkdirSync(syncFolder, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  it('does nothing when .git already exists', () => {
    fs.mkdirSync(path.join(syncFolder, '.git'));
    ensureGitRepo(syncFolder);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('creates git repo and .gitignore when missing', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    ensureGitRepo(syncFolder);

    expect(execSync).toHaveBeenCalledWith('git init', expect.any(Object));
    expect(execSync).toHaveBeenCalledWith('git add .gitignore', expect.any(Object));

    const gitignore = fs.readFileSync(path.join(syncFolder, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.trmm-manifest.json');
  });

  it('appends to existing .gitignore', () => {
    fs.writeFileSync(path.join(syncFolder, '.gitignore'), 'node_modules\n', 'utf-8');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    ensureGitRepo(syncFolder);

    const gitignore = fs.readFileSync(path.join(syncFolder, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('node_modules');
    expect(gitignore).toContain('.trmm-manifest.json');
  });

  it('does not duplicate .trmm-manifest.json in .gitignore', () => {
    fs.writeFileSync(path.join(syncFolder, '.gitignore'), '.trmm-manifest.json\n', 'utf-8');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));

    ensureGitRepo(syncFolder);

    const gitignore = fs.readFileSync(path.join(syncFolder, '.gitignore'), 'utf-8');
    const matches = gitignore.match(/\.trmm-manifest\.json/g);
    expect(matches).toHaveLength(1);
  });
});

describe('commitSyncChanges', () => {
  let syncFolder: string;
  const logger = { appendLine: vi.fn(), show: vi.fn() };

  beforeEach(() => {
    syncFolder = path.join(getTmpDir(), 'git-commit-test');
    fs.mkdirSync(syncFolder, { recursive: true });
    fs.mkdirSync(path.join(syncFolder, 'scripts'), { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(syncFolder, { recursive: true, force: true });
  });

  it('skips commit when no changes', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    commitSyncChanges(syncFolder, 'push', logger);
    expect(logger.appendLine).toHaveBeenCalledWith('  📋 No changes to commit');
  });

  it('commits changes when files are staged', () => {
    const mock = vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from(''))  // 1. git init
      .mockReturnValueOnce(Buffer.from(''))  // 2. git add .gitignore
      .mockReturnValueOnce(Buffer.from(''))  // 3. git commit -m "initial sync folder"
      .mockReturnValueOnce(Buffer.from(''))  // 4. git add scripts/ snippets/ reports/
      .mockReturnValueOnce('M\tscripts/test.ps1')  // 5. git diff --cached (string with utf-8 encoding)
      .mockReturnValueOnce(Buffer.from(''));  // 6. git commit

    commitSyncChanges(syncFolder, 'pull', logger);

    expect(logger.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Git committed')
    );
  });

  it('logs on commit failure', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from(''))  // 1. git init
      .mockReturnValueOnce(Buffer.from(''))  // 2. git add .gitignore
      .mockReturnValueOnce(Buffer.from(''))  // 3. git commit -m "initial sync folder"
      .mockReturnValueOnce(Buffer.from(''))  // 4. git add scripts/ snippets/ reports/
      .mockReturnValueOnce('M\tfile')  // 5. git diff --cached (string)
      .mockImplementationOnce(() => { throw new Error('commit error'); });  // 6. git commit fails

    commitSyncChanges(syncFolder, 'push', logger);

    expect(logger.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Git commit failed')
    );
  });
});
