import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const lambdaClient = new LambdaClient({});
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.APP_URL || '*',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Starting success sync handler');
  
  try {
    const user = event.requestContext.authorizer?.claims;
    if (!user?.sub) {
      console.warn('Missing user claims in request');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    // Get stripeCustomerId from DynamoDB
    console.log('Fetching stripe customer ID for user:', user.sub);
    const { Item } = await docClient.send(new GetCommand({
      TableName: process.env.CUSTOMER_TABLE,
      Key: {
        userId: user.sub
      }
    }));

    if (!Item?.stripeCustomerId) {
      console.error('No stripe customer ID found for user:', user.sub);
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No stripe customer found' })
      };
    }

    console.log('Found stripe customer ID:', Item.stripeCustomerId);

    // Invoke sync function with stripe customer ID and wait for response
    console.log('Invoking sync function');
    const { Payload, FunctionError } = await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.STRIPE_SYNC_FUNCTION_NAME,
      InvocationType: 'RequestResponse', // Synchronous invocation
      Payload: Buffer.from(JSON.stringify({
        stripeCustomerId: Item.stripeCustomerId
      }))
    }));

    if (FunctionError) {
      console.error('Sync function error:', FunctionError);
      throw new Error(FunctionError);
    }

    if (!Payload) {
      throw new Error('No response from sync function');
    }

    const response = JSON.parse(Buffer.from(Payload).toString());
    console.log('Sync function response:', response);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error('API Sync error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to sync stripe data',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
