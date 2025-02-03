// build.js
const esbuild = require('esbuild');
const path = require('path');

// Common esbuild configuration
const baseConfig = {
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node18',
  external: [
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/client-lambda',
    '@aws-sdk/client-apigateway',
    '@aws-sdk/client-cloudformation',
    // Add any other AWS SDK v3 packages you're using
  ],
  format: 'cjs',
};

// Build all functions
async function buildFunctions() {
  try {
    // Build checkout function
    await esbuild.build({
      ...baseConfig,
      entryPoints: ['src/checkout/create-checkout.ts'],
      outfile: 'dist/checkout/create-checkout.js',
    });

    // Build webhook function
    await esbuild.build({
      ...baseConfig,
      entryPoints: ['src/webhook/stripe-webhook.ts'],
      outfile: 'dist/webhook/stripe-webhook.js',
    });

    // Build sync function
    await esbuild.build({
      ...baseConfig,
      entryPoints: ['src/sync/sync-stripe-data.ts'],
      outfile: 'dist/sync/sync-stripe-data.js',
    });
    await esbuild.build({
      ...baseConfig,
      entryPoints: ['src/success/success-stripe-sync.ts'],
      outfile: 'dist/success/success-stripe-sync.js',
    });

    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildFunctions();
