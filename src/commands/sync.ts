import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig, validateConfig } from '../utils/config';
import { pullFromApi, pushToApi, SyncResult, ConflictResolver } from '../sync/syncEngine';

function makeConflictResolver(): ConflictResolver | undefined {
  const config = getConfig();
  if (config.conflictStrategy !== 'ask') return undefined;

  return async (filePath: string, direction: 'pull' | 'push') => {
    const relPath = path.basename(filePath);
    const directionLabel = direction === 'pull' ? 'API changed' : 'Local changed';
    const choice = await vscode.window.showQuickPick(
      [
        { label: `$(cloud-download) Use API version`, description: `Overwrite local file with API content`, id: 'api' as const },
        { label: `$(edit) Use Local version`, description: `Keep local file, push to API`, id: 'local' as const },
      ],
      {
        placeHolder: `${directionLabel}: ${relPath} — which version wins?`,
        canPickMany: false,
      }
    );
    return choice?.id || 'api';
  };
}

export function registerSyncCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.sync', async () => {
      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        vscode.window.showErrorMessage(`TRMM: ${err}. Configure in settings.`);
        return;
      }

      outputChannel.show(true);
      outputChannel.appendLine(`\n🔄 Full Sync: ${config.apiUrl}`);

      let pullResult: SyncResult | undefined;
      let pushResult: SyncResult | undefined;

      const onConflict = makeConflictResolver();

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'TRMM: Full sync in progress...' },
        async () => {
          outputChannel.appendLine('\n--- Phase 1: Pull ---');
          pullResult = await pullFromApi(
            config.apiUrl, config.apiKey, config.syncFolder,
            outputChannel, config.conflictStrategy, onConflict
          );

          outputChannel.appendLine('\n--- Phase 2: Push ---');
          pushResult = await pushToApi(
            config.apiUrl, config.apiKey, config.syncFolder,
            outputChannel, config.conflictStrategy, onConflict
          );
        }
      );

      const totalErrors = (pullResult?.errors.length || 0) + (pushResult?.errors.length || 0);
      const msg = `TRMM: Sync complete — Pull: ${pullResult?.pulled} updated/${pullResult?.created} new | Push: ${pushResult?.pushed} updated/${pushResult?.created} created`;

      if (totalErrors === 0) {
        vscode.window.showInformationMessage(msg);
      } else {
        vscode.window.showWarningMessage(`${msg} (${totalErrors} errors)`);
      }
    })
  );
}
