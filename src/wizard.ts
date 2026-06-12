import * as vscode from 'vscode';
import { setSecretApiKey } from './utils/config';
import { TrmmApi } from './api/trmmApi';
import { toErrorMessage } from './logger';

export async function showSetupWizard(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('trmm');

  const go = await vscode.window.showInformationMessage(
    'Welcome to TRMM! Let\'s configure the extension so you can sync scripts.',
    'Set Up', 'Later'
  );
  if (go !== 'Set Up') return;

  const apiUrl = await vscode.window.showInputBox({
    title: 'TRMM API URL',
    placeHolder: 'https://rmm-api.example.com',
    prompt: 'Enter your Tactical RMM API base URL',
    validateInput: (v) => {
      if (!v) return 'API URL is required';
      if (!v.startsWith('http://') && !v.startsWith('https://')) return 'Must start with http:// or https://';
      return null;
    },
    ignoreFocusOut: true,
  });
  if (!apiUrl) { await vscode.window.showWarningMessage('Setup cancelled.'); return; }

  const apiKey = await vscode.window.showInputBox({
    title: 'TRMM API Key',
    placeHolder: 'Enter your API key',
    prompt: 'Sent as X-API-KEY header. Stored securely in your OS keychain.',
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey) { await vscode.window.showWarningMessage('Setup cancelled.'); return; }

  let syncFolder = await vscode.window.showInputBox({
    title: 'Sync Folder',
    placeHolder: '/home/user/trmm-scripts',
    prompt: 'Local folder where scripts/snippets/reports will be synced',
    ignoreFocusOut: true,
  });
  if (!syncFolder) { await vscode.window.showWarningMessage('Setup cancelled.'); return; }

  const browseItem = '$(folder) Browse...';
  if (syncFolder === browseItem) {
    const uris = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, title: 'Select Sync Folder' });
    if (!uris || uris.length === 0) { await vscode.window.showWarningMessage('Setup cancelled.'); return; }
    syncFolder = uris[0].fsPath;
  }

  const enableGitHistory = await vscode.window.showQuickPick(
    ['Yes', 'No'],
    {
      title: 'Enable Git History Sync',
      placeHolder: 'Store script git history on the API for cross-machine sync?',
      ignoreFocusOut: true,
    }
  );
  if (!enableGitHistory) { await vscode.window.showWarningMessage('Setup cancelled.'); return; }

  const defaultShell = await vscode.window.showQuickPick(
    ['powershell', 'python', 'cmd', 'shell', 'nushell', 'deno'],
    {
      title: 'Default Shell',
      placeHolder: 'Select the default shell for new scripts',
      ignoreFocusOut: true,
    }
  );
  if (!defaultShell) { await vscode.window.showWarningMessage('Setup cancelled.'); return; }

  const autoPush = await vscode.window.showQuickPick(
    ['Yes', 'No'],
    {
      title: 'Auto-Push on Save',
      placeHolder: 'Automatically push file changes to the API when you save?',
      ignoreFocusOut: true,
    }
  );
  if (!autoPush) { await vscode.window.showWarningMessage('Setup cancelled.'); return; }

  const doTest = await vscode.window.showQuickPick(
    ['Test Connection', 'Skip'],
    {
      title: 'Test Connection',
      placeHolder: 'Verify the API URL and key work?',
      ignoreFocusOut: true,
    }
  );
  if (!doTest) { await vscode.window.showWarningMessage('Setup cancelled.'); return; }

  if (doTest === 'Test Connection') {
    try {
      const api = new TrmmApi(apiUrl.replace(/\/+$/, ''), apiKey);
      await api.fetchAgents();
      vscode.window.showInformationMessage('✅ Connection successful!');
    } catch (e: unknown) {
      const ok = await vscode.window.showErrorMessage(
        `❌ Connection failed: ${toErrorMessage(e)}. Save settings anyway?`,
        'Save', 'Cancel'
      );
      if (ok !== 'Save') return;
    }
  }

  await cfg.update('apiUrl', apiUrl.replace(/\/+$/, ''), vscode.ConfigurationTarget.Global);
  setSecretApiKey(apiKey);
  await context.secrets.store('trmm.apiKey', apiKey);
  await cfg.update('syncFolder', syncFolder, vscode.ConfigurationTarget.Global);
  await cfg.update('enableGitHistory', enableGitHistory === 'Yes', vscode.ConfigurationTarget.Global);
  await cfg.update('defaultShell', defaultShell, vscode.ConfigurationTarget.Global);
  await cfg.update('autoPush', autoPush === 'Yes', vscode.ConfigurationTarget.Global);

  await context.globalState.update('trmm.setupCompleted', true);

  const action = await vscode.window.showInformationMessage(
    '✅ TRMM is configured! Ready to sync your scripts.',
    'Pull Scripts Now', 'Open Editor'
  );
  if (action === 'Pull Scripts Now') {
    vscode.commands.executeCommand('trmm.pull');
  } else if (action === 'Open Editor') {
    vscode.commands.executeCommand('trmm.openEditor');
  }
}
