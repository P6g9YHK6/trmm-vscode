import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn() })),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(() => true) })) },
  commands: { executeCommand: vi.fn() },
  languages: { registerDocumentLinkProvider: vi.fn() },
  extensions: { getExtension: vi.fn() },
  Uri: { file: vi.fn() },
}));

describe('parseArgs', () => {
  const originalArgv = process.argv;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, TRMM_API_URL: '', TRMM_API_KEY: '', TRMM_SYNC_FOLDER: '', VITEST: 'true' };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('parses pull command with short flags', async () => {
    process.argv = ['node', 'cli.ts', 'pull', '-u', 'https://api.example.com', '-k', 'abc', '-d', '/tmp'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.command).toBe('pull');
    expect(opts.apiUrl).toBe('https://api.example.com');
    expect(opts.apiKey).toBe('abc');
    expect(opts.syncFolder).toBe('/tmp');
  });

  it('parses push command with long flags', async () => {
    process.argv = ['node', 'cli.ts', 'push', '--api-url=https://x.com', '--api-key=key', '--sync-folder=/s'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.command).toBe('push');
    expect(opts.apiUrl).toBe('https://x.com');
    expect(opts.apiKey).toBe('key');
    expect(opts.syncFolder).toBe('/s');
  });

  it('parses sync command', async () => {
    process.argv = ['node', 'cli.ts', 'sync', '-u', 'https://a.com', '-k', 'k', '-d', '/f'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.command).toBe('sync');
  });

  it('reads from env vars when flags not provided', async () => {
    process.env.TRMM_API_URL = 'https://env.example.com';
    process.env.TRMM_API_KEY = 'env-key';
    process.env.TRMM_SYNC_FOLDER = '/env/folder';
    process.argv = ['node', 'cli.ts', 'pull'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.apiUrl).toBe('https://env.example.com');
    expect(opts.apiKey).toBe('env-key');
    expect(opts.syncFolder).toBe('/env/folder');
  });

  it('parses conflict flag', async () => {
    process.argv = ['node', 'cli.ts', 'pull', '-u', 'https://a.com', '-k', 'k', '-d', '/f', '-c', 'local'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.conflict).toBe('local');
  });

  it('parses enable-git-history flag', async () => {
    process.argv = ['node', 'cli.ts', 'pull', '-u', 'https://a.com', '-k', 'k', '-d', '/f', '--enable-git-history=true'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.enableGitHistory).toBe(true);
  });

  it('parses import command with git-url', async () => {
    process.argv = ['node', 'cli.ts', 'import', '-g', 'https://github.com/a/b.git', '--git-path', 'scripts/'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.command).toBe('import');
    expect(opts.gitUrl).toBe('https://github.com/a/b.git');
    expect(opts.gitPath).toBe('scripts/');
  });

  it('parses stale-strategy flag', async () => {
    process.argv = ['node', 'cli.ts', 'push', '-u', 'https://a.com', '-k', 'k', '-d', '/f', '--stale-strategy=overwrite'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.staleStrategy).toBe('overwrite');
  });

  it('defaults stale-strategy to skip', async () => {
    process.argv = ['node', 'cli.ts', 'push', '-u', 'https://a.com', '-k', 'k', '-d', '/f'];
    const { parseArgs } = await import('../cli');
    const opts = parseArgs();
    expect(opts.staleStrategy).toBe('skip');
  });

  it('exits with --help', async () => {
    process.argv = ['node', 'cli.ts', '--help'];
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { parseArgs } = await import('../cli');
    parseArgs();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits on unknown command', async () => {
    process.argv = ['node', 'cli.ts', 'bogus'];
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { parseArgs } = await import('../cli');
    parseArgs();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
