import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Lambda } from 'aws-sdk';

const lambda = new Lambda();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = event.requestContext.authorizer?.claims;
    
    // Get stripeCustomerId from DynamoDB using userId
    const { Payload } = await lambda.invoke({
      FunctionName: process.env.STRIPE_SYNC_FUNCTION_NAME!,
      Payload: JSON.stringify({
        stripeCustomerId: user.sub // Pass Cognito user ID
      })
    }).promise();

    const response = JSON.parse(Payload as string);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error('API Sync error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to sync stripe data' 
      })
    };
  }
};
