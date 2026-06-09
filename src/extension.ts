import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig } from './utils/config';
import { registerPullCommand } from './commands/pull';
import { registerPushCommand, registerPushFileCommand } from './commands/push';
import { registerSyncCommand } from './commands/sync';
import { registerTestOnAgentCommand } from './commands/testOnAgent';
import { registerNewScriptCommand } from './commands/newScript';
import { registerEditMetadataCommand } from './commands/editMetadata';
import { registerOpenSyncFolderCommand } from './commands/openSyncFolder';
import { parseMetadata, buildFileContent } from './sync/metadata';
import { sha256, hashUrl } from './sync/hash';
import { inferShell, isScriptFile } from './utils/pathBuilder';
import { TrmmApi } from './api/trmmApi';
import { ScriptEditorProvider } from './views/ScriptEditorProvider';
import { toErrorMessage } from './logger';
import * as fs from 'fs';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('TRMM Sync');

  outputChannel.appendLine('activated');

  registerPullCommand(context, outputChannel);
  registerPushCommand(context, outputChannel);
  registerPushFileCommand(context, outputChannel);
  registerSyncCommand(context, outputChannel);
  registerTestOnAgentCommand(context, outputChannel);
  registerNewScriptCommand(context);
  registerEditMetadataCommand(context);
  registerOpenSyncFolderCommand(context);

  registerAutoSave(context);
  registerStatusBar(context);

  const editorProvider = new ScriptEditorProvider(context.extensionUri, outputChannel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ScriptEditorProvider.viewType, editorProvider)
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
      if (currentHash === parsed.metadata.code_hash) return;

      const payload = {
        name: parsed.metadata.name,
        description: parsed.metadata.description,
        shell: parsed.metadata.shell,
        category: parsed.metadata.category,
        script_body: parsed.code,
        args: parsed.metadata.args,
        env_vars: parsed.metadata.env_vars,
        default_timeout: parsed.metadata.default_timeout,
        run_as_user: parsed.metadata.run_as_user,
        syntax: parsed.metadata.syntax,
        favorite: parsed.metadata.favorite,
        hidden: parsed.metadata.hidden,
        supported_platforms: parsed.metadata.supported_platforms,
      };

      try {
        const api = new TrmmApi(config.apiUrl, config.apiKey);
        await api.updateScript(existingId, payload);
        parsed.metadata.code_hash = currentHash;
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
}

export function deactivate() {}
