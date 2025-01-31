// scripts/update-api.ts
import { APIGateway } from 'aws-sdk';
import { CloudFormation } from 'aws-sdk';

const apigateway = new APIGateway();
const cloudformation = new CloudFormation();

async function updateApiRoutes() {
  // Get stack outputs
  const { Stacks } = await cloudformation.describeStacks({
    StackName: 'StripeBackendStack'
  }).promise();

  const stack = Stacks?.[0];
  if (!stack) throw new Error('Stack not found');

  // Get function ARNs from stack outputs
  const checkoutArn = stack.Outputs?.find(o => o.OutputKey === 'CheckoutFunction')?.OutputValue;
  const webhookArn = stack.Outputs?.find(o => o.OutputKey === 'WebhookFunction')?.OutputValue;
  const syncArn = stack.Outputs?.find(o => o.OutputKey === 'syncFunction')?.OutputValue;

  if (!checkoutArn || !webhookArn) {
    throw new Error('Function ARNs not found in stack outputs');
  }

  // Update checkout route
  await apigateway.updateIntegration({
    restApiId: process.env.API_ID!,
    resourceId: 'sub/checkout',
    httpMethod: 'POST',
    patchOperations: [
      {
        op: 'replace',
        path: '/uri',
        value: `arn:aws:apigateway:${process.env.AWS_REGION}:lambda:path/2015-03-31/functions/${checkoutArn}/invocations`
      }
    ]
  }).promise();

  // Update webhook route
  await apigateway.updateIntegration({
    restApiId: process.env.API_ID!,
    resourceId: 'sub/webhook'!,
    httpMethod: 'POST',
    patchOperations: [
      {
        op: 'replace',
        path: '/uri',
        value: `arn:aws:apigateway:${process.env.AWS_REGION}:lambda:path/2015-03-31/functions/${webhookArn}/invocations`
      }
    ]
  }).promise();

  await apigateway.updateIntegration({
    restApiId: process.env.API_ID!,
    resourceId: 'sub/sync'!,
    httpMethod: 'POST',
    patchOperations: [
      {
        op: 'replace',
        path: '/uri',
        value: `arn:aws:apigateway:${process.env.AWS_REGION}:lambda:path/2015-03-31/functions/${syncArn}/invocations`
      }
    ]
  }).promise();

  console.log('API routes updated successfully');
}

updateApiRoutes().catch(console.error);
