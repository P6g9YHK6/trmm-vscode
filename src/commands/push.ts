import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig, validateConfig, showConfigError } from '../utils/config';
import { pushToApi, ConfirmMutation } from '../sync/syncEngine';
import { parseMetadata, buildFileContent } from '../sync/metadata';
import { sha256, hashUrl } from '../sync/hash';
import { TrmmApi } from '../api/trmmApi';
import { inferShell } from '../utils/pathBuilder';
import { makeConflictResolver } from './conflictResolver';

export function registerPushCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.push', async () => {
      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        await showConfigError(err);
        return;
      }

      if (!config.enablePush) {
        outputChannel.show(true);
        outputChannel.appendLine('\n⏭️ Push disabled (enablePush = false)');
        return;
      }

      outputChannel.show(true);
      outputChannel.appendLine(`\n🚀 Push to ${config.apiUrl}`);

      const confirmMutation: ConfirmMutation | undefined = config.paranoidMode
        ? async (type, desc) => {
            const choice = await vscode.window.showWarningMessage(
              `Paranoid Mode: ${type} ${desc}?`,
              { modal: true },
              'Yes', 'No'
            );
            return choice === 'Yes';
          }
        : undefined;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'TRMM: Pushing changes to API...' },
        async () => {
          const result = await pushToApi(
            config.apiUrl,
            config.apiKey,
            config.syncFolder,
            outputChannel,
            config.conflictStrategy,
            makeConflictResolver(),
            confirmMutation,
            config.staleStrategy,
            config.enableScripts,
            config.enableReports,
            config.enableGitHistory,
          );

          if (result.errors.length === 0) {
            vscode.window.showInformationMessage(
              `TRMM: Push complete — ${result.pushed} updated, ${result.created} created, ${result.skipped} unchanged`
            );
          } else {
            vscode.window.showWarningMessage(
              `TRMM: Push finished with ${result.errors.length} errors. Check output for details.`
            );
          }
        }
      );
    })
  );
}

import { toErrorMessage } from '../logger';

export function registerPushFileCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.pushFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        await showConfigError(err);
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const relPath = path.relative(config.syncFolder, filePath);

      outputChannel.show(true);
      outputChannel.appendLine(`\n🚀 Push file: ${relPath}`);

      const content = editor.document.getText();
      const shell = inferShell(filePath);
      const parsed = parseMetadata(content, shell);

      if (!parsed) {
        vscode.window.showWarningMessage('No TRMM metadata found in this file. Use "TRMM: Push All" to create it on the API.');
        return;
      }

      const currentHash = sha256(parsed.code);
      const existingId = parsed.metadata.ids[hashUrl(config.apiUrl)];

      if (existingId === undefined) {
        vscode.window.showWarningMessage('No API ID for this instance. Use "TRMM: Push All" to create it.');
        return;
      }

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
          `Paranoid Mode: update script ${relPath} on API?`,
          { modal: true },
          'Yes', 'No'
        );
        if (ok !== 'Yes') {
          outputChannel.appendLine(`  ⏭️ Skipped push (paranoid): ${relPath}`);
          return;
        }
      }

      try {
        const api = new TrmmApi(config.apiUrl, config.apiKey);
        await api.updateScript(existingId, payload);
        parsed.metadata.code_hash = currentHash;
        fs.writeFileSync(filePath, buildFileContent(parsed.code, parsed.metadata), 'utf-8');
        outputChannel.appendLine(`  ✅ Pushed: ${relPath}`);
        vscode.window.showInformationMessage(`TRMM: Pushed ${relPath}`);
      } catch (e: unknown) {
        const msg = toErrorMessage(e);
        outputChannel.appendLine(`  ❌ ${msg}`);
        vscode.window.showErrorMessage(`Failed to push: ${msg}`);
      }
    })
  );
}


