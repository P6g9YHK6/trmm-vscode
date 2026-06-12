import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { TrmmApi } from '../api/trmmApi';
import { Logger, toErrorMessage } from '../logger';

export const GIT_HISTORY_SCRIPT_NAME = '__git_history__';

// Validates that all files under rootDir resolve within baseDir.
// Calls onBadEntry(relativePath) for any entry that escapes baseDir
// and removes it. Returns number of removed entries.
export function validateExtractedPaths(
  rootDir: string,
  baseDir: string,
  onBadEntry?: (entry: string) => void,
): number {
  let removed = 0;
  const baseResolved = path.resolve(baseDir);

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let resolved: string;
      try {
        resolved = path.resolve(full);
      } catch { continue; }
      if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
        fs.rmSync(full, { recursive: true, force: true });
        removed++;
        const rel = path.relative(rootDir, full);
        onBadEntry?.(rel);
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  }

  walk(rootDir);
  return removed;
}

export async function pullGitHistory(
  apiUrl: string,
  apiKey: string,
  syncFolder: string,
  outputChannel: Logger,
): Promise<void> {
  const api = new TrmmApi(apiUrl, apiKey);

  outputChannel.appendLine('\n----- Git History -----');

  const scripts = await api.fetchScripts();
  const gitScript = scripts.find(s => s.name === GIT_HISTORY_SCRIPT_NAME);
  if (!gitScript) {
    outputChannel.appendLine('  ⏭️ No git history on API');
    return;
  }

  outputChannel.appendLine(`  📥 Downloading git history (script #${gitScript.id})`);
  const download = await api.downloadScript(gitScript.id);
  const body = download.code;

  const buffer = Buffer.from(body, 'base64');
  const gitDir = path.join(syncFolder, '.git');

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'trmm-git-'));
  try {
    const archivePath = path.join(tmpDir, 'git.tar.gz');
    fs.writeFileSync(archivePath, buffer);
    execFileSync('tar', ['xzf', archivePath, '-C', tmpDir], { stdio: 'pipe' });

    validateExtractedPaths(tmpDir, tmpDir, (entry) => {
      outputChannel.appendLine(`  ⚠️ Removed suspicious archive entry: ${entry}`);
    });

    const extractedGit = path.join(tmpDir, '.git');
    if (!fs.existsSync(extractedGit)) {
      outputChannel.appendLine('  ⚠️ No .git found in archive');
      return;
    }

    // Backup existing .git before replacing
    const gitBackup = gitDir + '.bak';
    if (fs.existsSync(gitDir)) {
      fs.cpSync(gitDir, gitBackup, { recursive: true });
    }
    try {
      fs.rmSync(gitDir, { recursive: true, force: true });
      fs.cpSync(extractedGit, gitDir, { recursive: true });
      outputChannel.appendLine('  ✅ Git history restored');
    } catch (restoreErr) {
      if (fs.existsSync(gitBackup)) {
        fs.rmSync(gitDir, { recursive: true, force: true });
        fs.cpSync(gitBackup, gitDir, { recursive: true });
      }
      throw restoreErr;
    } finally {
      if (fs.existsSync(gitBackup)) {
        fs.rmSync(gitBackup, { recursive: true, force: true });
      }
      if (fs.existsSync(extractedGit)) {
        fs.rmSync(extractedGit, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function pushGitHistory(
  apiUrl: string,
  apiKey: string,
  syncFolder: string,
  outputChannel: Logger,
): Promise<void> {
  const gitDir = path.join(syncFolder, '.git');
  if (!fs.existsSync(gitDir)) {
    outputChannel.appendLine('  ⏭️ No .git directory to push');
    return;
  }

  outputChannel.appendLine('\n----- Git History -----');

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'trmm-git-'));
  try {
    const archivePath = path.join(tmpDir, 'git.tar.gz');
    execFileSync('tar', ['czf', archivePath, '-C', syncFolder, '.git'], { stdio: 'pipe' });
    const archiveBuffer = fs.readFileSync(archivePath);
    const body = archiveBuffer.toString('base64');

    const api = new TrmmApi(apiUrl, apiKey);
    const scripts = await api.fetchScripts();
    const gitScript = scripts.find(s => s.name === GIT_HISTORY_SCRIPT_NAME);

    const scriptPayload = {
      name: GIT_HISTORY_SCRIPT_NAME,
      description: '',
      shell: 'powershell',
      category: '',
      script_body: body,
      args: [],
      env_vars: [],
      default_timeout: 0,
      run_as_user: false,
      syntax: '',
      favorite: false,
      hidden: true,
      supported_platforms: [],
    };

    if (gitScript) {
      await api.updateScript(gitScript.id, scriptPayload);
      outputChannel.appendLine('  📤 Git history pushed');
    } else {
      await api.createScript(scriptPayload);
      outputChannel.appendLine('  ✅ Git history script created');
    }
  } catch (e: unknown) {
    outputChannel.appendLine(`  ❌ Git history push failed: ${toErrorMessage(e)}`);
    throw e;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
