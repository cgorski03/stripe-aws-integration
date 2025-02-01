// scripts/update-api.ts
import { APIGateway, CloudFormation } from 'aws-sdk';
import * as dotenv from 'dotenv';

dotenv.config();

// Set AWS config
const config = {
  region: process.env.AWS_REGION || 'us-east-1'
};

const apigateway = new APIGateway(config);
const cloudformation = new CloudFormation(config);

async function updateApiRoutes() {
  try {
    // Get stack outputs
    const { Stacks } = await cloudformation.describeStacks({
      StackName: 'StripeBackendStack'
    }).promise();

    const stack = Stacks?.[0];
    if (!stack) throw new Error('Stack not found');

    // Get function ARNs from stack outputs
    const checkoutArn = stack.Outputs?.find(o => o.OutputKey === 'CheckoutFunction')?.OutputValue;
    const webhookArn = stack.Outputs?.find(o => o.OutputKey === 'WebhookFunction')?.OutputValue;
    const syncArn = stack.Outputs?.find(o => o.OutputKey === 'SyncFunction')?.OutputValue;

    if (!checkoutArn || !webhookArn || !syncArn) {
      throw new Error('Function ARNs not found in stack outputs');
    }

    console.log('Found ARNs:', { checkoutArn, webhookArn, syncArn });

    // Get resource IDs
    const { items: resources } = await apigateway.getResources({
      restApiId: process.env.API_ID!
    }).promise();

    const checkoutResource = resources?.find(r => r.path === '/subscription/checkout');
    const webhookResource = resources?.find(r => r.path === '/subscription/webhook');
    const syncResource = resources?.find(r => r.path === '/subscription/sync');

    if (!checkoutResource?.id || !webhookResource?.id || !syncResource?.id) {
      throw new Error('Resource IDs not found');
    }

    // Update checkout route
    await apigateway.updateIntegration({
      restApiId: process.env.API_ID!,
      resourceId: checkoutResource.id,
      httpMethod: 'POST',
      patchOperations: [
        {
          op: 'replace',
          path: '/uri',
          value: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/${checkoutArn}/invocations`
        }
      ]
    }).promise();

    // Update webhook route
    await apigateway.updateIntegration({
      restApiId: process.env.API_ID!,
      resourceId: webhookResource.id,
      httpMethod: 'POST',
      patchOperations: [
        {
          op: 'replace',
          path: '/uri',
          value: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/${webhookArn}/invocations`
        }
      ]
    }).promise();

    // Update sync route
    await apigateway.updateIntegration({
      restApiId: process.env.API_ID!,
      resourceId: syncResource.id,
      httpMethod: 'POST',
      patchOperations: [
        {
          op: 'replace',
          path: '/uri',
          value: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/${syncArn}/invocations`
        }
      ]
    }).promise();

    // Create deployment
    await apigateway.createDeployment({
      restApiId: process.env.API_ID!,
      stageName: process.env.API_STAGE || 'prod',
      description: 'Updated Lambda integrations'
    }).promise();

    console.log('API routes updated and deployed successfully');
  } catch (error) {
    console.error('Error updating API:', error);
    throw error;
  }
}

updateApiRoutes().catch(console.error);
