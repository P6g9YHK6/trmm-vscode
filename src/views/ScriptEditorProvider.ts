import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig, validateConfig, TrmmConfig } from '../utils/config';
import { TrmmApi, Agent } from '../api/trmmApi';
import {
  parseMetadata, parseBlockCommentMetadata, buildMetadataBlock, buildFileContent,
  findMetadataBlockRange, ScriptMetadata,
} from '../sync/metadata';
import { inferShell, isScriptFile, buildScriptPath } from '../utils/pathBuilder';
import { hashUrl } from '../sync/hash';
import { getWebviewHtml } from './scriptEditorWebview';
import { toErrorMessage } from '../logger';

let agentsCache: Agent[] = [];
let cachedApiUrl = '';
let categoriesCache: string[] = [];

interface ParseResult {
  code: string;
  metadata: ScriptMetadata;
  format: 'line' | 'block';
}

export class ScriptEditorProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'trmm-editor';
  private _view?: vscode.WebviewView;
  private _outputChannel: vscode.OutputChannel;
  private _testOutputChannel: vscode.OutputChannel;
  private _debounceTimer?: ReturnType<typeof setTimeout>;
  private _isUpdating = false;
  private _lastValidMetadata: { hasScript: true; metadata: ScriptMetadata & { script_body: string; _hasApiId: boolean; _format: string } } | null = null;

  constructor(private readonly _extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
    this._outputChannel = outputChannel;
    this._testOutputChannel = vscode.window.createOutputChannel('TRMM Test Output');
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewHtml();

    webviewView.webview.onDidReceiveMessage(this._handleMessage.bind(this));

    const config = getConfig();
    const configErr = validateConfig(config);
    webviewView.webview.postMessage({
      type: 'init',
      configValid: !configErr,
      configError: configErr || undefined,
    });

    this._syncFromActiveEditor();
    this._fetchCategories();

    if (config.apiUrl && config.apiKey && config.apiUrl !== cachedApiUrl) {
      this._fetchAgents(config);
    }

    this._registerDocumentListeners();
  }

  private _log(msg: string) {
    this._outputChannel.appendLine(`[ScriptEditor] ${msg}`);
  }

  private _tryParseAll(content: string, shell: string, filePath?: string): ParseResult | null {
    if (shell === 'powershell' || shell === 'python' || shell === 'deno') {
      const blockParsed = parseBlockCommentMetadata(content);
      if (blockParsed) {
        this._log(`Parsed block-comment metadata (${shell})${filePath ? ': ' + filePath : ''}`);
        return { ...blockParsed, format: 'block' };
      }
    }

    const lineParsed = parseMetadata(content, shell);
    if (lineParsed) {
      this._log(`Parsed line-by-line metadata (${shell})${filePath ? ': ' + filePath : ''}`);
      return { ...lineParsed, format: 'line' };
    }

    this._log(`No metadata found (${shell})${filePath ? ': ' + filePath : ''}`);
    return null;
  }

  private _registerDocumentListeners() {
    vscode.workspace.onDidChangeTextDocument(e => {
      if (this._isUpdating) return;
      if (e.document === vscode.window.activeTextEditor?.document) {
        this._syncFromActiveEditor();
      }
    });

    vscode.window.onDidChangeActiveTextEditor(() => {
      this._syncFromActiveEditor();
    });
  }

  private _syncFromActiveEditor() {
    if (!this._view) return;

    const editor = vscode.window.activeTextEditor;

    if (!editor || (editor.document.uri.scheme !== 'file' && editor.document.uri.scheme !== 'untitled')) {
      if (this._lastValidMetadata) return;
      this._view.webview.postMessage({ type: 'metadataUpdate', hasScript: false, reason: 'No editor open', metadata: null });
      return;
    }

    const filePath = editor.document.uri.fsPath;
    if (!isScriptFile(filePath)) {
      if (this._lastValidMetadata) return;
      this._view.webview.postMessage({ type: 'metadataUpdate', hasScript: false, reason: 'Not a script file', metadata: null });
      return;
    }

    const content = editor.document.getText();
    const shell = inferShell(filePath);
    const parsed = this._tryParseAll(content, shell, filePath);

    if (!parsed) {
      this._view.webview.postMessage({ type: 'metadataUpdate', hasScript: false, reason: 'No metadata block found', metadata: null });
      return;
    }

    const config = getConfig();
    const hasApiId = config.apiUrl ? parsed.metadata.ids[hashUrl(config.apiUrl)] !== undefined : false;

    const metaPayload = { ...parsed.metadata, script_body: parsed.code, _hasApiId: hasApiId, _format: parsed.format };
    this._lastValidMetadata = { hasScript: true, metadata: metaPayload };
    this._view.webview.postMessage({
      type: 'metadataUpdate',
      hasScript: true,
      metadata: metaPayload,
    });
  }

  private async _handleMessage(message: { type: string; [key: string]: unknown }) {
    switch (message.type) {
      case 'ready':
        break;

      case 'updateField':
        await this._handleFieldUpdate(message.field as string, message.value as string);
        break;

      case 'getAgents':
        await this._fetchAgents(getConfig());
        break;

      case 'testOnAgent':
        await this._handleTestOnAgent(message.agentId as string);
        break;

      case 'testOnServer':
        await this._handleTestOnServer();
        break;

      case 'getCategories':
        this._fetchCategories();
        break;
    }
  }

  private async _handleFieldUpdate(field: string, value: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const filePath = editor.document.uri.fsPath;
    if (!isScriptFile(filePath)) return;

    const content = editor.document.getText();
    const shell = inferShell(filePath);
    const parsed = this._tryParseAll(content, shell, filePath);
    if (!parsed) return;

    const keyMap: Record<string, string> = {
      'name': 'name',
      'description': 'description',
      'shell': 'shell',
      'supported_platforms': 'supported_platforms',
      'category': 'category',
      'args': 'args',
      'env_vars': 'env_vars',
      'default_timeout': 'default_timeout',
      'run_as_user': 'run_as_user',
      'syntax': 'syntax',
      'strip_metadata': 'strip_metadata',
    };

    const metaKey = keyMap[field];
    if (!metaKey) return;

    const updateMeta = { ...parsed.metadata };

    switch (field) {
      case 'name':
        updateMeta.name = value; break;
      case 'description':
        updateMeta.description = value; break;
      case 'shell':
        updateMeta.shell = value; break;
      case 'supported_platforms':
        try { updateMeta.supported_platforms = JSON.parse(value); } catch { updateMeta.supported_platforms = []; }
        break;
      case 'category':
        updateMeta.category = value; break;
      case 'args':
        try { updateMeta.args = JSON.parse(value); } catch { updateMeta.args = []; }
        break;
      case 'env_vars':
        try { updateMeta.env_vars = JSON.parse(value); } catch { updateMeta.env_vars = []; }
        break;
      case 'default_timeout':
        updateMeta.default_timeout = parseInt(value) || 90; break;
      case 'run_as_user':
        updateMeta.run_as_user = value === 'true'; break;
      case 'syntax':
        updateMeta.syntax = value; break;
      case 'strip_metadata':
        updateMeta.strip_metadata = value === 'true'; break;
    }

    const oldCategory = parsed.metadata.category;

    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      await this._applyMetadataUpdate(editor, content, shell, updateMeta);

      if (field === 'category' && value !== oldCategory) {
        await this._moveScriptFile(editor, filePath, shell, updateMeta);
      }
    }, 300);
  }

  private async _applyMetadataUpdate(editor: vscode.TextEditor, content: string, shell: string, meta: ScriptMetadata) {
    const range = findMetadataBlockRange(content, shell);
    if (!range) {
      const newContent = buildFileContent(content, meta);
      await editor.edit(editBuilder => {
        const full = new vscode.Range(0, 0, editor.document.lineCount, 0);
        editBuilder.replace(full, newContent.endsWith('\n') ? newContent : newContent + '\n');
      });
      return;
    }

    const newBlock = buildMetadataBlock(meta);
    const endLineLen = editor.document.lineAt(range.endLine).text.length;
    this._isUpdating = true;
    await editor.edit(editBuilder => {
      editBuilder.replace(
        new vscode.Range(range.beginLine, 0, range.endLine, endLineLen),
        newBlock,
      );
    });
    this._isUpdating = false;
  }

  private async _fetchAgents(config: TrmmConfig) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: 'agentsLoading' });

    const err = validateConfig(config);
    if (err) {
      this._view.webview.postMessage({ type: 'agentsError', error: err });
      return;
    }

    try {
      const api = new TrmmApi(config.apiUrl, config.apiKey);
      agentsCache = await api.fetchAgents();
      cachedApiUrl = config.apiUrl;
      this._view.webview.postMessage({ type: 'agentsUpdate', agents: agentsCache });
    } catch (e: unknown) {
      this._view.webview.postMessage({ type: 'agentsError', error: toErrorMessage(e) });
    }
  }

  private _fetchCategories() {
    const config = getConfig();
    if (!config.syncFolder) return;

    const scriptsDir = path.join(config.syncFolder, 'scripts');
    if (!fs.existsSync(scriptsDir)) return;

    const cats = new Set<string>();
    const walk = (dir: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            cats.add(entry.name);
            walk(fullPath);
          } else if (entry.isFile() && isScriptFile(fullPath)) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const shell = inferShell(fullPath);
            const parsed = this._tryParseAll(content, shell, fullPath);
            if (parsed?.metadata.category) cats.add(parsed.metadata.category);
          }
        }
      } catch { }
    };
    walk(scriptsDir);
    categoriesCache = [...cats].sort();
    this._view?.webview.postMessage({ type: 'categoriesUpdate', categories: categoriesCache });
  }

  private async _moveScriptFile(editor: vscode.TextEditor, oldPath: string, shell: string, meta: ScriptMetadata) {
    const config = getConfig();
    if (!config.syncFolder) return;

    const scriptsDir = path.join(config.syncFolder, 'scripts');
    if (!oldPath.startsWith(scriptsDir)) return;

    const newPath = buildScriptPath(config.syncFolder, meta.name, meta.category, shell);
    if (newPath === oldPath) return;

    await editor.document.save();

    const targetDir = path.dirname(newPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const content = fs.readFileSync(oldPath, 'utf-8');
    fs.writeFileSync(newPath, content, 'utf-8');
    fs.unlinkSync(oldPath);

    const doc = await vscode.workspace.openTextDocument(newPath);
    await vscode.window.showTextDocument(doc, editor.viewColumn);

    this._fetchCategories();
  }

  private async _handleTestOnAgent(agentId: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const filePath = editor.document.uri.fsPath;
    const content = editor.document.getText();
    const shell = inferShell(filePath);
    const parsed = this._tryParseAll(content, shell, filePath);
    if (!parsed) return;

    const config = getConfig();
    try {
      const api = new TrmmApi(config.apiUrl, config.apiKey);
      this._testOutputChannel.clear();
      this._testOutputChannel.appendLine(`[Test on Agent] ${filePath}`);
      this._testOutputChannel.appendLine(`[Agent] ${agentId}`);
      this._testOutputChannel.appendLine(`[Shell] ${parsed.metadata.shell}`);
      this._testOutputChannel.appendLine('---');
      const result = await api.testOnAgent(agentId, {
        code: parsed.code,
        timeout: parsed.metadata.default_timeout,
        args: parsed.metadata.args,
        shell: parsed.metadata.shell,
        run_as_user: parsed.metadata.run_as_user,
        env_vars: parsed.metadata.env_vars,
      });
      this._testOutputChannel.appendLine(`Return code: ${result.returncode}`);
      this._testOutputChannel.appendLine(`Execution time: ${result.execution_time}s`);
      if (result.stdout) this._testOutputChannel.appendLine(`\nSTDOUT:\n${result.stdout}`);
      if (result.stderr) this._testOutputChannel.appendLine(`\nSTDERR:\n${result.stderr}`);
      this._testOutputChannel.show();
    } catch (e: unknown) {
      this._testOutputChannel.appendLine(`[Error] ${toErrorMessage(e)}`);
      this._testOutputChannel.show();
    }
  }

  private async _handleTestOnServer() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const filePath = editor.document.uri.fsPath;
    const content = editor.document.getText();
    const shell = inferShell(filePath);
    const parsed = this._tryParseAll(content, shell, filePath);
    if (!parsed) return;

    const config = getConfig();
    try {
      const api = new TrmmApi(config.apiUrl, config.apiKey);
      this._testOutputChannel.clear();
      this._testOutputChannel.appendLine(`[Test on Server] ${filePath}`);
      this._testOutputChannel.appendLine(`[Shell] ${parsed.metadata.shell}`);
      this._testOutputChannel.appendLine('---');
      const result = await api.testOnServer({
        code: parsed.code,
        timeout: parsed.metadata.default_timeout,
        args: parsed.metadata.args,
        shell: parsed.metadata.shell,
        run_as_user: parsed.metadata.run_as_user,
        env_vars: parsed.metadata.env_vars,
      });
      this._testOutputChannel.appendLine(`Return code: ${result.returncode}`);
      this._testOutputChannel.appendLine(`Execution time: ${result.execution_time}s`);
      if (result.stdout) this._testOutputChannel.appendLine(`\nSTDOUT:\n${result.stdout}`);
      if (result.stderr) this._testOutputChannel.appendLine(`\nSTDERR:\n${result.stderr}`);
      this._testOutputChannel.show();
    } catch (e: unknown) {
      this._testOutputChannel.appendLine(`[Error] ${toErrorMessage(e)}`);
      this._testOutputChannel.show();
    }
  }
}
