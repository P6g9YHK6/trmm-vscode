import * as vscode from 'vscode';
import { getConfig, validateConfig } from '../utils/config';

export function registerOpenSyncFolderCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.openSyncFolder', async () => {
      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        vscode.window.showErrorMessage(`TRMM: ${err}. Configure in settings first.`);
        return;
      }

      const uri = vscode.Uri.file(config.syncFolder);
      const existing = vscode.workspace.workspaceFolders?.find(
        f => f.uri.fsPath === uri.fsPath
      );

      if (existing) {
        vscode.window.showInformationMessage('Sync folder is already open in workspace.');
        return;
      }

      vscode.workspace.updateWorkspaceFolders(
        vscode.workspace.workspaceFolders?.length || 0,
        0,
        { uri, name: 'TRMM Scripts' }
      );

      vscode.window.showInformationMessage(`TRMM: Opened sync folder: ${config.syncFolder}`);
    })
  );
}
