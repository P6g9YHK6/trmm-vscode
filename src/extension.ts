import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig, setSecretApiKey } from './utils/config';
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
import { toErrorMessage } from './logger';
import * as fs from 'fs';

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('TRMM Sync');

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

  registerPullCommand(context, outputChannel);
  registerPushCommand(context, outputChannel);
  registerPushFileCommand(context, outputChannel);
  registerSyncCommand(context, outputChannel);
  registerTestOnAgentCommand(context, outputChannel);
  registerNewScriptCommand(context);
  registerEditMetadataCommand(context);
  registerOpenSyncFolderCommand(context);
  registerImportFromGitCommand(context, outputChannel);

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

      if (config.paranoidMode) {
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

export function deactivate() {}
