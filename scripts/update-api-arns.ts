// scripts/update-api.ts
import { 
  APIGatewayClient, 
  GetResourcesCommand,
  UpdateIntegrationCommand,
  CreateDeploymentCommand
} from "@aws-sdk/client-api-gateway";
import { 
  CloudFormationClient, 
  DescribeStacksCommand 
} from "@aws-sdk/client-cloudformation";
import * as dotenv from 'dotenv';

dotenv.config();

const config = {
  region: process.env.AWS_REGION || 'us-east-1'
};

const apigateway = new APIGatewayClient(config);
const cloudformation = new CloudFormationClient(config);

async function updateApiRoutes() {
  try {
    // Get stack outputs
    const { Stacks } = await cloudformation.send(
      new DescribeStacksCommand({
        StackName: 'StripeBackendStack'
      })
    );

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
    const { items: resources } = await apigateway.send(
      new GetResourcesCommand({
        restApiId: process.env.API_ID
      })
    );

    const checkoutResource = resources?.find(r => r.path === '/subscription/checkout');
    const webhookResource = resources?.find(r => r.path === '/subscription/webhook');
    const syncResource = resources?.find(r => r.path === '/subscription/sync');

    if (!checkoutResource?.id || !webhookResource?.id || !syncResource?.id) {
      throw new Error('Resource IDs not found');
    }

    // Update checkout route
    await apigateway.send(
      new UpdateIntegrationCommand({
        restApiId: process.env.API_ID,
        resourceId: checkoutResource.id,
        httpMethod: 'POST',
        patchOperations: [
          {
            op: 'replace',
            path: '/uri',
            value: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/${checkoutArn}/invocations`
          }
        ]
      })
    );

    // Update webhook route
    await apigateway.send(
      new UpdateIntegrationCommand({
        restApiId: process.env.API_ID,
        resourceId: webhookResource.id,
        httpMethod: 'POST',
        patchOperations: [
          {
            op: 'replace',
            path: '/uri',
            value: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/${webhookArn}/invocations`
          }
        ]
      })
    );

    // Update sync route
    await apigateway.send(
      new UpdateIntegrationCommand({
        restApiId: process.env.API_ID,
        resourceId: syncResource.id,
        httpMethod: 'POST',
        patchOperations: [
          {
            op: 'replace',
            path: '/uri',
            value: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/${syncArn}/invocations`
          }
        ]
      })
    );

    // Create deployment
    await apigateway.send(
      new CreateDeploymentCommand({
        restApiId: process.env.API_ID,
        stageName: process.env.API_STAGE || 'prod',
        description: 'Updated Lambda integrations'
      })
    );

    console.log('API routes updated and deployed successfully');
  } catch (error) {
    console.error('Error updating API:', error);
    throw error;
  }
}

updateApiRoutes().catch(console.error);
