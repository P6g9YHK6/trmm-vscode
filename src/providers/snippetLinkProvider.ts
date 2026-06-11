import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '../utils/config';

export class SnippetLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const config = getConfig();
    if (!config.syncFolder) return [];

    const snippetsDir = path.join(config.syncFolder, 'snippets');
    if (!fs.existsSync(snippetsDir)) return [];

    const links: vscode.DocumentLink[] = [];
    const text = document.getText();
    const regex = /\{\{\s*([^}]+)\s*\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const snippetName = match[1].trim();
      if (!snippetName) continue;
      const snippetPath = path.join(snippetsDir, `${snippetName}.ps1`);
      if (fs.existsSync(snippetPath)) {
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        links.push(new vscode.DocumentLink(
          new vscode.Range(startPos, endPos),
          vscode.Uri.file(snippetPath),
        ));
      }
    }

    return links;
  }
}
