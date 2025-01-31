// lib/stripe-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import path from 'path';

export class StripeFunctionsStack extends cdk.Stack {
  public readonly checkoutFunction: string;
  public readonly webhookFunction: string;
  public readonly syncFunction: string;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Lambda functions
    const checkoutFunction = new lambda.Function(this, 'StripeCheckout', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'checkout/create-checkout.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/checkout')),
      environment: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
        STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID!,
        APP_URL: process.env.APP_URL!,
        CUSTOMER_TABLE: process.env.CUSTOMER_TABLE!,
      },
    });

    
    const syncFunction = new lambda.Function(this, 'SyncStripeDataToKV', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'sync/sync-stripe-data.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/sync')),
      environment: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
        CUSTOMER_TABLE: process.env.CUSTOMER_TABLE!,
      },
    });
    
    const webhookFunction = new lambda.Function(this, 'StripeWebhook', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'webhook/stripe-webhook.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/webhook')),
      environment: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET!,
        STRIPE_SYNC_FUNCTION_NAME: syncFunction.functionName
      },
    });
    const successSyncFunction = new lambda.Function(this, 'StripeSuccessSync', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'success/success-stripe-sync.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/success')),
      environment: {
        STRIPE_SYNC_FUNCTION_NAME: syncFunction.functionName
      },
    });
    // Allow webhook to invoke sync
    syncFunction.grantInvoke(webhookFunction);
    syncFunction.grantInvoke(successSyncFunction);
    this.checkoutFunction = checkoutFunction.functionArn;
    this.webhookFunction = webhookFunction.functionArn;
    this.syncFunction = successSyncFunction.functionArn;
  }
}
