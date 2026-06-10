import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig, validateConfig } from '../utils/config';
import { pullFromApi } from '../sync/syncEngine';
import { makeConflictResolver } from './conflictResolver';

export function registerPullCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.pull', async () => {
      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        vscode.window.showErrorMessage(`TRMM: ${err}. Configure in settings.`);
        return;
      }

      if (!config.enablePull) {
        outputChannel.show(true);
        outputChannel.appendLine('\n⏭️ Pull disabled (enablePull = false)');
        return;
      }

      outputChannel.show(true);
      outputChannel.appendLine(`\n🚀 Pull from ${config.apiUrl}`);

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'TRMM: Pulling scripts from API...' },
        async () => {
          const result = await pullFromApi(
            config.apiUrl,
            config.apiKey,
            config.syncFolder,
            outputChannel,
            config.conflictStrategy,
            makeConflictResolver(),
            config.gitSync,
            config.enableScripts,
            config.enableReports,
          );

          if (result.errors.length === 0) {
            vscode.window.showInformationMessage(
              `TRMM: Pull complete — ${result.pulled} updated, ${result.created} new, ${result.deleted} removed`
            );
          } else {
            vscode.window.showWarningMessage(
              `TRMM: Pull finished with ${result.errors.length} errors. Check output for details.`
            );
          }
        }
      );
    })
  );
}
