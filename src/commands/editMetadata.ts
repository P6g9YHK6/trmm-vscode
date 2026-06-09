import * as vscode from 'vscode';
import { parseMetadata, buildFileContent, setMetadataValue } from '../sync/metadata';
import { sha256 } from '../sync/hash';
import { inferShell } from '../utils/pathBuilder';

export function registerEditMetadataCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.editMetadata', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Open a script file first');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const content = editor.document.getText();
      const shell = inferShell(filePath);
      const parsed = parseMetadata(content, shell);

      if (!parsed) {
        vscode.window.showWarningMessage('No TRMM metadata found in this file.');
        return;
      }

      const fields = [
        { label: 'name', detail: parsed.metadata.name },
        { label: 'description', detail: parsed.metadata.description },
        { label: 'category', detail: parsed.metadata.category },
        { label: 'shell', detail: parsed.metadata.shell },
        { label: 'default_timeout', detail: String(parsed.metadata.default_timeout) },
        { label: 'run_as_user', detail: String(parsed.metadata.run_as_user) },
        { label: 'favorite', detail: String(parsed.metadata.favorite) },
        { label: 'hidden', detail: String(parsed.metadata.hidden) },
        { label: 'syntax', detail: parsed.metadata.syntax },
        { label: 'args', detail: JSON.stringify(parsed.metadata.args) },
        { label: 'env_vars', detail: JSON.stringify(parsed.metadata.env_vars) },
        { label: 'supported_platforms', detail: JSON.stringify(parsed.metadata.supported_platforms) },
      ];

      const pick = await vscode.window.showQuickPick(
        fields.map(f => ({ label: f.label, description: f.detail })),
        { placeHolder: 'Select metadata field to edit' }
      );
      if (!pick) return;

      const newValue = await vscode.window.showInputBox({
        placeHolder: `New value for ${pick.label}`,
        value: pick.description,
      });
      if (newValue === undefined) return;

      setMetadataValue(parsed.metadata, pick.label, newValue);
      parsed.metadata.code_hash = sha256(parsed.code);

      const newContent = buildFileContent(parsed.code, parsed.metadata);

      const edit = new vscode.WorkspaceEdit();
      const uri = editor.document.uri;
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(content.length)
      );
      edit.replace(uri, fullRange, newContent);
      await vscode.workspace.applyEdit(edit);

      vscode.window.showInformationMessage(`TRMM: Updated ${pick.label}`);
    })
  );
}


