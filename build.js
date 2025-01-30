const esbuild = require('esbuild');
const path = require('path');

const functionName = process.argv[2];
if (!functionName) {
  console.error('Please specify a function name');
  process.exit(1);
}

esbuild.build({
  entryPoints: [`src/${functionName}/index.ts`],
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node18',
  outfile: `dist/${functionName}/index.js`,
  external: ['aws-sdk'],
}).catch(() => process.exit(1));
