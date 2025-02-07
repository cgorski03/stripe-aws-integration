import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import Stripe from "stripe";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { APIGatewayEventRequestContextWithAuthorizer } from "aws-lambda";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Initialize DynamoDB clients
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);


interface CognitoAuthorizerEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayEventRequestContextWithAuthorizer<{
    claims: {
      sub: string; // Cognito user sub
    };
  }>;
}

export const handler = async (
  event: CognitoAuthorizerEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Starting manage-subscription handler', { 
    requestId: event.requestContext.requestId 
  });

  try {
    const cognitoSub = event.requestContext.authorizer.claims.sub;
    console.log('Retrieved Cognito sub', { cognitoSub });

    if (!cognitoSub) {
      console.warn('No Cognito sub found in request');
      return {
        statusCode: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "Unauthorized - No user ID found",
        }),
      };
    }

    // Look up the Stripe customer ID from DynamoDB
    const getCustomerCommand: GetCommandInput = {
      TableName: process.env.CUSTOMER_TABLE!,
      Key: {
        userId: cognitoSub,
      },
    };

    console.log('Fetching customer from DynamoDB', { cognitoSub });
    const customerResult = await docClient.send(new GetCommand(getCustomerCommand));

    if (!customerResult.Item?.stripeCustomerId) {
      console.warn('No Stripe customer found', { cognitoSub });
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "No Stripe customer found for this user",
        }),
      };
    }

    console.log('Found Stripe customer', { 
      stripeCustomerId: customerResult.Item.stripeCustomerId 
    });

    // Create a billing portal session with the found Stripe customer ID
    console.log('Creating billing portal session');
    const session = await stripe.billingPortal.sessions.create({
      customer: customerResult.Item.stripeCustomerId,
      return_url: process.env.APP_URL,
    });

    console.log('Successfully created billing portal session', { 
      sessionId: session.id 
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        url: session.url,
      }),
    };
  } catch (error) {
    console.error('Error in manage-subscription handler:', error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Failed to create billing portal session",
      }),
    };
  }
};
