import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig, validateConfig, showConfigError } from '../utils/config';
import { pullFromApi, pushToApi, SyncResult, ConfirmMutation } from '../sync/syncEngine';
import { makeConflictResolver } from './conflictResolver';
import { Logger } from '../logger';

export function registerSyncCommand(context: vscode.ExtensionContext, outputChannel: Logger) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.sync', async () => {
      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        await showConfigError(err);
        return;
      }

      if (!config.enablePull && !config.enablePush) {
        outputChannel.show(true);
        outputChannel.appendLine('\n⏭️ Sync disabled (enablePull = false and enablePush = false)');
        return;
      }

      outputChannel.show(true);
      outputChannel.appendLine(`\n🔄 Full Sync: ${config.apiUrl}`);
      outputChannel.verbose(`Config: url=${config.apiUrl}, syncFolder=${config.syncFolder}, scripts=${config.enableScripts}, reports=${config.enableReports}, gitHistory=${config.enableGitHistory}`);

      let pullResult: SyncResult | undefined;
      let pushResult: SyncResult | undefined;

      const onConflict = makeConflictResolver();
      const confirmMutation: ConfirmMutation | undefined = config.paranoidMode > 0
        ? (() => {
            let count = 0;
            return async (type, desc) => {
              count++;
              if (count < config.paranoidMode) return true;
              const choice = await vscode.window.showWarningMessage(
                `Paranoid Mode: ${type} ${desc}?`,
                { modal: true },
                'Yes', 'No'
              );
              return choice === 'Yes';
            };
          })()
        : undefined;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'TRMM: Full sync in progress...' },
        async () => {
          if (config.enablePull) {
            outputChannel.appendLine('\n--- Phase 1: Pull ---');
            pullResult = await pullFromApi(
              config.apiUrl, config.apiKey, config.syncFolder,
              outputChannel, config.conflictStrategy, onConflict,
              config.enableScripts, config.enableReports,
              config.enableGitHistory
            );
          } else {
            outputChannel.appendLine('\n--- Phase 1: Pull (disabled) ---');
            pullResult = { pulled: 0, pushed: 0, created: 0, deleted: 0, skipped: 0, errors: [] };
          }

          if (config.enablePush) {
            outputChannel.appendLine('\n--- Phase 2: Push ---');
            pushResult = await pushToApi(
              config.apiUrl, config.apiKey, config.syncFolder,
              outputChannel, config.conflictStrategy, onConflict,
              confirmMutation, config.staleStrategy,
              config.enableScripts, config.enableReports,
              config.enableGitHistory
            );
          } else {
            outputChannel.appendLine('\n--- Phase 2: Push (disabled) ---');
            pushResult = { pulled: 0, pushed: 0, created: 0, deleted: 0, skipped: 0, errors: [] };
          }
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
