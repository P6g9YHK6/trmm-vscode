import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig, setSecretApiKey, clearSecretApiKey, validateConfig } from './utils/config';
import { showSetupWizard } from './wizard';
import { registerPullCommand } from './commands/pull';
import { registerPushCommand, registerPushFileCommand } from './commands/push';
import { registerSyncCommand } from './commands/sync';
import { registerTestOnAgentCommand } from './commands/testOnAgent';
import { registerNewScriptCommand } from './commands/newScript';
import { registerEditMetadataCommand } from './commands/editMetadata';
import { registerOpenSyncFolderCommand } from './commands/openSyncFolder';
import { registerImportFromGitCommand } from './commands/importFromGit';
import { parseMetadata, buildFileContent, computeMetaHash } from './sync/metadata';
import { sha256, hashUrl } from './sync/hash';
import { inferShell, isScriptFile } from './utils/pathBuilder';
import { TrmmApi } from './api/trmmApi';
import { ScriptEditorProvider } from './views/ScriptEditorProvider';
import { SnippetLinkProvider } from './providers/snippetLinkProvider';
import { TrmmScmProvider } from './scmProvider';
import { Logger, LogChannel, toErrorMessage } from './logger';
import * as fs from 'fs';

let outputChannel: Logger;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = new LogChannel(vscode.window.createOutputChannel('TRMM Sync'));

  const cfg = vscode.workspace.getConfiguration('trmm');
  const settingsKey = cfg.get<string>('apiKey', '');
  if (settingsKey) {
    setSecretApiKey(settingsKey);
    await context.secrets.store('trmm.apiKey', settingsKey);
    await cfg.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
    outputChannel.appendLine('apiKey migrated from settings to SecretStorage');
  } else {
    const storedKey = await context.secrets.get('trmm.apiKey');
    if (storedKey) {
      setSecretApiKey(storedKey);
    }
  }

  outputChannel.appendLine('activated');

  const setupDone = context.globalState.get<boolean>('trmm.setupCompleted', false);
  const configErr = validateConfig(getConfig());
  if (!setupDone || configErr) {
    const choice = await vscode.window.showInformationMessage(
      'TRMM extension needs configuration to sync scripts.',
      'Set Up', 'Later'
    );
    if (choice === 'Set Up') {
      await showSetupWizard(context);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.setupWizard', () => showSetupWizard(context))
  );

  registerPullCommand(context, outputChannel);
  registerPushCommand(context, outputChannel);
  registerPushFileCommand(context, outputChannel);
  registerSyncCommand(context, outputChannel);
  registerTestOnAgentCommand(context, outputChannel);
  registerNewScriptCommand(context);
  registerEditMetadataCommand(context);
  registerOpenSyncFolderCommand(context);
  registerImportFromGitCommand(context, outputChannel);

  await registerGitPublishHook(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.debugAuth', async () => {
      const config = getConfig();
      const masked = config.apiKey
        ? config.apiKey.slice(0, 4) + '…' + config.apiKey.slice(-4)
        : '(not set)';
      outputChannel.appendLine(`--- Auth Debug ---`);
      outputChannel.appendLine(`API URL: ${config.apiUrl || '(not set)'}`);
      outputChannel.appendLine(`API Key: ${masked}`);
      outputChannel.appendLine(`Sync Folder: ${config.syncFolder || '(not set)'}`);
      const secretState = await context.secrets.get('trmm.apiKey');
      outputChannel.appendLine(`SecretStorage key: ${secretState ? 'present' : 'not set'}`);
      outputChannel.appendLine(``);

      if (!config.apiUrl || !config.apiKey) {
        outputChannel.appendLine(`❌ Cannot test: API URL or Key is not configured`);
      } else {
        outputChannel.appendLine(`Testing auth: GET ${config.apiUrl}/agents/?limit=1 ...`);
        try {
          const api = new TrmmApi(config.apiUrl, config.apiKey);
          const response = await api.fetchAgents();
          outputChannel.appendLine(`✅ Auth OK — ${response.length} agent(s) returned`);
        } catch (e: unknown) {
          const errMsg = toErrorMessage(e);
          outputChannel.appendLine(`❌ Auth failed: ${errMsg}`);
        }
      }

      outputChannel.show();
    })
  );

  registerAutoSave(context);
  registerStatusBar(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.openEditor', () => {
      vscode.commands.executeCommand('workbench.view.extension.trmm');
    })
  );

  const editorProvider = new ScriptEditorProvider(context.extensionUri, outputChannel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ScriptEditorProvider.viewType, editorProvider)
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      { pattern: '**/scripts/**' },
      new SnippetLinkProvider(),
    )
  );

  const scmProvider = new TrmmScmProvider(getConfig().syncFolder || '');
  context.subscriptions.push(scmProvider);
  scmProvider.refresh();

  if (getConfig().syncFolder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(getConfig().syncFolder, '{scripts,snippets}/**')
    );
    watcher.onDidChange(() => scmProvider.refresh());
    watcher.onDidCreate(() => scmProvider.refresh());
    watcher.onDidDelete(() => scmProvider.refresh());
    context.subscriptions.push(watcher);
  }

}

async function registerGitPublishHook(context: vscode.ExtensionContext) {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) {
    outputChannel.appendLine('Git extension not available — skipping publish hook');
    return;
  }

  try {
    await gitExt.activate();
    outputChannel.verbose(`Git extension active: ${gitExt.isActive}`);

    const api = gitExt.exports.getAPI(1);

    if (typeof api.registerRemoteSourcePublisher !== 'function') {
      outputChannel.appendLine('Git API missing registerRemoteSourcePublisher — trying git-base fallback');
      await registerGitBasePublishHook(context);
      return;
    }

    const publisher = {
      name: 'Push to TRMM',
      icon: 'cloud-upload',
      async publishRepository() {
        await vscode.commands.executeCommand('trmm.push');
      },
    };

    const disposable = api.registerRemoteSourcePublisher(publisher);
    context.subscriptions.push(disposable);
    outputChannel.appendLine('Registered TRMM publish hook');
  } catch (e: unknown) {
    outputChannel.appendLine(`Failed to register TRMM publish hook: ${toErrorMessage(e)}`);
    outputChannel.verbose(`Stack: ${(e as Error).stack || 'no stack'}`);
  }
}

async function registerGitBasePublishHook(context: vscode.ExtensionContext) {
  const gitBaseExt = vscode.extensions.getExtension('vscode.git-base');
  if (!gitBaseExt) {
    outputChannel.appendLine('git-base extension not available — skipping fallback');
    return;
  }

  try {
    await gitBaseExt.activate();
    const gitBaseApi = gitBaseExt.exports.getAPI(1);

    if (typeof gitBaseApi.registerRemoteSourceProvider !== 'function') {
      outputChannel.appendLine('git-base API missing registerRemoteSourceProvider');
      return;
    }

    const disposable = gitBaseApi.registerRemoteSourceProvider({
      name: 'TRMM',
      icon: 'cloud-upload',
      supportsQuery: false,
      async getRemoteSources() { return []; },
      async publishRepository() {
        await vscode.commands.executeCommand('trmm.push');
      },
    });
    context.subscriptions.push(disposable);
    outputChannel.appendLine('Registered TRMM publish hook via git-base');
  } catch (e: unknown) {
    outputChannel.appendLine(`Failed to register git-base publish hook: ${toErrorMessage(e)}`);
  }
}


function registerAutoSave(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const config = getConfig();
      if (!config.autoPush) return;
      if (!config.apiUrl || !config.apiKey || !config.syncFolder) return;

      const filePath = doc.uri.fsPath;
      if (!filePath.startsWith(config.syncFolder)) return;

      if (!isScriptFile(filePath)) return;

      const relPath = path.relative(config.syncFolder, filePath);
      const content = doc.getText();
      const shell = inferShell(filePath);
      const parsed = parseMetadata(content, shell);

      if (!parsed) return;

      const currentHash = sha256(parsed.code);
      const existingId = parsed.metadata.ids[hashUrl(config.apiUrl)];

      if (existingId === undefined) return;
      const currentMetaHash = computeMetaHash(parsed.metadata);
      if (currentHash === parsed.metadata.code_hash && currentMetaHash === (parsed.metadata.meta_hash || '')) return;

      const payload = {
        name: parsed.metadata.name,
        description: parsed.metadata.description,
        shell: parsed.metadata.shell,
        category: parsed.metadata.category,
        script_body: config.stripMetadata !== false ? parsed.code : content,
        args: parsed.metadata.args,
        env_vars: parsed.metadata.env_vars,
        default_timeout: parsed.metadata.default_timeout,
        run_as_user: parsed.metadata.run_as_user,
        syntax: parsed.metadata.syntax,
        favorite: parsed.metadata.favorite,
        hidden: parsed.metadata.hidden,
        supported_platforms: parsed.metadata.supported_platforms,
      };

      if (config.paranoidMode === 1) {
        const ok = await vscode.window.showWarningMessage(
          `Paranoid Mode: auto-push update of ${relPath} to API?`,
          { modal: true },
          'Yes', 'No'
        );
        if (ok !== 'Yes') {
          outputChannel.appendLine(`⏭️ Skipped auto-push (paranoid): ${relPath}`);
          return;
        }
      }

      try {
        const api = new TrmmApi(config.apiUrl, config.apiKey);
        await api.updateScript(existingId, payload);
        parsed.metadata.code_hash = currentHash;
        parsed.metadata.meta_hash = currentMetaHash;
        fs.writeFileSync(filePath, buildFileContent(parsed.code, parsed.metadata), 'utf-8');
        outputChannel.appendLine(`pushed ${relPath}`);
      } catch (e: unknown) {
        outputChannel.appendLine(`push failed ${relPath}: ${toErrorMessage(e)}`);
      }
    })
  );
}

function registerStatusBar(context: vscode.ExtensionContext) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  item.text = '$(sync) TRMM';
  item.tooltip = 'Click to sync scripts';
  item.command = 'trmm.sync';
  item.show();
  context.subscriptions.push(item);

  const editorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1);
  editorBtn.text = '$(edit) TRMM Editor';
  editorBtn.tooltip = 'Open TRMM script editor side panel';
  editorBtn.command = 'trmm.openEditor';
  editorBtn.show();
  context.subscriptions.push(editorBtn);
}

export function deactivate(): void {
  clearSecretApiKey();
}
