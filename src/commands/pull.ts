import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig, validateConfig } from '../utils/config';
import { pullFromApi, ConflictResolver } from '../sync/syncEngine';

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

export function registerPullCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.pull', async () => {
      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        vscode.window.showErrorMessage(`TRMM: ${err}. Configure in settings.`);
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
            makeConflictResolver()
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
