const esbuild = require('esbuild');

const shared = {
  platform: 'node',
  target: 'node16',
  external: ['vscode'],
  minify: true,
  sourcemap: false,
};

async function main() {
  await esbuild.build({
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    format: 'cjs',
    bundle: true,
  });

  await esbuild.build({
    ...shared,
    entryPoints: ['src/cli.ts'],
    outfile: 'out/cli.js',
    format: 'cjs',
    bundle: true,
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
