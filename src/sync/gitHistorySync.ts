import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { TrmmApi } from '../api/trmmApi';
import { Logger, toErrorMessage } from '../logger';

export const GIT_HISTORY_SCRIPT_NAME = '__git_history__';

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
    execSync('tar xzf "' + archivePath + '" -C "' + tmpDir + '"', { stdio: 'pipe' });

    const extractedGit = path.join(tmpDir, '.git');
    if (!fs.existsSync(extractedGit)) {
      outputChannel.appendLine('  ⚠️ No .git found in archive');
      return;
    }

    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }
    fs.renameSync(extractedGit, gitDir);
    outputChannel.appendLine('  ✅ Git history restored');
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
    execSync('tar czf "' + archivePath + '" -C "' + syncFolder + '" .git', { stdio: 'pipe' });
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
