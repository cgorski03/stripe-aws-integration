import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import path from "path";
import * as dotenv from "dotenv";
import * as iam from "aws-cdk-lib/aws-iam";

// Determine the environment
const environment = process.env.ENV_STAGE || "dev"; // Default to 'development'

// Load environment variables based on the environment
if (environment === "prod") {
  dotenv.config({ path: ".env.prod" });
  console.log("Loading production environment variables");
} else {
  dotenv.config({ path: ".env.dev" });
  console.log("Loading development environment variables");
}

// Validate environment variables
const requiredEnvVars = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "APP_URL",
  "CUSTOMER_TABLE",
  "STRIPE_WEBHOOK_SECRET",
  "COGNITO_USER_POOL_ID",
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
  public readonly manageBillingFunction: string;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the StripeCustomers table
    const customersTable = new dynamodb.Table(this, "StripeCustomers", {
      tableName: process.env.CUSTOMER_TABLE,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY, // RETAIN for production data
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

    const manageBillingFunction = new lambda.Function(
      this,
      "StripeManageBilling",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "manage/manage-subscription.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../dist/manage")),
        environment: {
          STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
          APP_URL: process.env.APP_URL!,
          CUSTOMER_TABLE: customersTable.tableName,
        },
      },
    );
    // This function only needs read
    customersTable.grantReadData(manageBillingFunction);

    const syncFunction = new lambda.Function(this, "SyncStripeDataToKV", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "sync/sync-stripe-data.handler",
      timeout: cdk.Duration.seconds(10),
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist/sync")),
      environment: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
        CUSTOMER_TABLE: customersTable.tableName,
        COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID!,
      },
    });

    syncFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cognito-idp:AdminUpdateUserAttributes"],
        resources: [
          `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${process.env.COGNITO_USER_POOL_ID}`,
        ],
      }),
    );
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

    // Allow webhook handling function to invoke sync function
    syncFunction.grantInvoke(webhookFunction);
    // Allow the webhook function to read from the customers table
    customersTable.grantReadData(webhookFunction);

    // Store function ARNs
    this.checkoutFunction = checkoutFunction.functionArn;
    this.webhookFunction = webhookFunction.functionArn;
    this.syncFunction = syncFunction.functionArn;
    this.manageBillingFunction = manageBillingFunction.functionArn;

    // Add outputs
    new cdk.CfnOutput(this, `CheckoutFunction`, {
      value: this.checkoutFunction,
      exportName: `checkoutFunction-${environment}`,
    });

    new cdk.CfnOutput(this, `ManageBillingFunction`, {
      value: this.manageBillingFunction,
      exportName: `manageBillingFunction-${environment}`,
    });

    new cdk.CfnOutput(this, `WebhookFunction`, {
      value: this.webhookFunction,
      exportName: `webhookFunction-${environment}`,
    });

    new cdk.CfnOutput(this, `SyncFunction`, {
      value: this.syncFunction,
      exportName: `syncFunction-${environment}`,
    });

    new cdk.CfnOutput(this, `CustomersTableName`, {
      value: customersTable.tableName,
      exportName: `customersTableName-${environment}`,
    });
  }
}
