import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import path from "path";
import * as dotenv from "dotenv";

dotenv.config();

// Validate environment variables
const requiredEnvVars = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "APP_URL",
  "CUSTOMER_TABLE",
  "STRIPE_WEBHOOK_SECRET",
] as const;

requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
});

export class StripeFunctionsStack extends cdk.Stack {
  public readonly checkoutFunction: string;
  public readonly webhookFunction: string;
  public readonly syncFunction: string;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the StripeCustomers table
    const customersTable = new dynamodb.Table(this, "StripeCustomers", {
      tableName: process.env.CUSTOMER_TABLE,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // RETAIN for production data
    });

    // Add GSI for stripeCustomerId
    customersTable.addGlobalSecondaryIndex({
      indexName: "stripeCustomerId-index",
      partitionKey: {
        name: "stripeCustomerId",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Create Lambda functions
    const checkoutFunction = new lambda.Function(this, "StripeCheckout", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "checkout/create-checkout.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist/checkout")),
      environment: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
        STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID!,
        APP_URL: process.env.APP_URL!,
        CUSTOMER_TABLE: customersTable.tableName,
      },
    });

    // Grant DynamoDB permissions to checkout function
    customersTable.grantReadWriteData(checkoutFunction);

    const syncFunction = new lambda.Function(this, "SyncStripeDataToKV", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "sync/sync-stripe-data.handler",
      timeout: cdk.Duration.seconds(10),
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist/sync")),
      environment: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
        CUSTOMER_TABLE: customersTable.tableName,
      },
    });

    // Grant DynamoDB permissions to sync function
    customersTable.grantReadWriteData(syncFunction);

    const webhookFunction = new lambda.Function(this, "StripeWebhook", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "webhook/stripe-webhook.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist/webhook")),
      timeout: cdk.Duration.seconds(10),
      environment: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET!,
        STRIPE_SYNC_FUNCTION_NAME: syncFunction.functionName,
        CUSTOMER_TABLE: customersTable.tableName,
      },
    });

    const successSyncFunction = new lambda.Function(this, "StripeSuccessSync", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "success/success-stripe-sync.handler",
      timeout: cdk.Duration.seconds(10),
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist/success")),
      environment: {
        STRIPE_SYNC_FUNCTION_NAME: syncFunction.functionName,
        CUSTOMER_TABLE: customersTable.tableName,
      },
    });

    // Allow webhook and success functions to invoke sync function
    syncFunction.grantInvoke(webhookFunction);
    syncFunction.grantInvoke(successSyncFunction);

    // Grant DynamoDB read permissions to webhook function
    customersTable.grantReadData(webhookFunction);

    // Store function ARNs
    this.checkoutFunction = checkoutFunction.functionArn;
    this.webhookFunction = webhookFunction.functionArn;
    this.syncFunction = successSyncFunction.functionArn;

    // Add outputs
    new cdk.CfnOutput(this, "CheckoutFunction", {
      value: this.checkoutFunction,
      exportName: "checkoutFunction",
    });

    new cdk.CfnOutput(this, "WebhookFunction", {
      value: this.webhookFunction,
      exportName: "webhookFunction",
    });

    new cdk.CfnOutput(this, "SyncFunction", {
      value: this.syncFunction,
      exportName: "syncFunction",
    });

    new cdk.CfnOutput(this, "CustomersTableName", {
      value: customersTable.tableName,
      exportName: "customersTableName",
    });
  }
}
