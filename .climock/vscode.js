const vscodeMock = {
  workspace: {
    getConfiguration: () => ({
      get: (_key, def) => def,
    }),
  },
  window: {
    showWarningMessage: () => Promise.resolve('Rebuild from local'),
    showInformationMessage: () => Promise.resolve(undefined),
    createOutputChannel: () => ({
      appendLine: () => {},
      append: () => {},
      show: () => {},
    }),
    withProgress: async (_opts, fn) => fn(),
    createStatusBarItem: () => ({
      text: '', tooltip: '', command: '', show: () => {},
    }),
  },
  ProgressLocation: { Notification: 1 },
  Uri: { file: (p) => ({ fsPath: p, path: p }) },
  StatusBarAlignment: { Left: 1 },
  extensions: { getExtension: () => undefined },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve(undefined),
  },
  Disposable: { from: () => ({ dispose: () => {} }) },
};
module.exports = vscodeMock;
