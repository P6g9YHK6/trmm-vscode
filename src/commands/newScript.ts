import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '../utils/config';
import { buildFileContent, ScriptMetadata } from '../sync/metadata';
import { sha256 } from '../sync/hash';
import { getExtension, sanitizeName } from '../utils/pathBuilder';

export function registerNewScriptCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.newScript', async () => {
      const config = getConfig();
      if (!config.syncFolder) {
        vscode.window.showErrorMessage('TRMM: Configure trmm.syncFolder first');
        return;
      }

      const name = await vscode.window.showInputBox({
        placeHolder: 'Script name (e.g. Check Disk Space)',
        prompt: 'Enter a name for the new script',
      });
      if (!name) return;

      const shell = await vscode.window.showQuickPick(
        [
          { label: 'PowerShell', description: '.ps1', id: 'powershell' },
          { label: 'Python', description: '.py', id: 'python' },
          { label: 'Batch', description: '.bat', id: 'cmd' },
          { label: 'Shell', description: '.sh', id: 'shell' },
          { label: 'Nushell', description: '.nu', id: 'nushell' },
          { label: 'Deno/TypeScript', description: '.ts', id: 'deno' },
        ],
        { placeHolder: 'Select script shell type' }
      );
      if (!shell) return;

      const category = await vscode.window.showInputBox({
        placeHolder: 'Category (e.g. Checks, Tools, Backend)',
        prompt: 'Enter a category folder or leave empty',
      });

      const scriptsDir = path.join(config.syncFolder, 'scripts');
      const cat = (category || '').trim();
      const ext = getExtension(shell.id);
      const fileName = `${sanitizeName(name)}${ext}`;
      const filePath = cat
        ? path.join(scriptsDir, cat, fileName)
        : path.join(scriptsDir, fileName);

      if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`File already exists: ${fileName}`);
        return;
      }

      const stubCode = shell.id === 'powershell'
        ? '# Script created by TRMM VS Code extension\n\n'
        : shell.id === 'python'
          ? '# Script created by TRMM VS Code extension\n\n'
          : shell.id === 'cmd'
            ? '@echo off\nREM Script created by TRMM VS Code extension\n\n'
            : shell.id === 'shell'
              ? '#!/bin/bash\n# Script created by TRMM VS Code extension\n\n'
              : shell.id === 'nushell'
                ? '# Script created by TRMM VS Code extension\n\n'
                : '// Script created by TRMM VS Code extension\n\n';

      const metadata: ScriptMetadata = {
        name,
        description: '',
        shell: shell.id,
        category: cat,
        supported_platforms: [],
        args: [],
        env_vars: [],
        default_timeout: 90,
        run_as_user: false,
        syntax: '',
        favorite: false,
        hidden: false,
        code_hash: sha256(stubCode),
        ids: {},
      };

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buildFileContent(stubCode, metadata), 'utf-8');

      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`TRMM: Created ${cat ? cat + '/' : ''}${fileName}`);
    })
  );
}
