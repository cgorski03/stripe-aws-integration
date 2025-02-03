// create-checkout.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand 
} from '@aws-sdk/lib-dynamodb';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const CUSTOMER_TABLE = (process.env.CUSTOMER_TABLE as string);

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Received checkout request:', { 
    path: event.path,
    method: event.httpMethod,
    userId: event.requestContext.authorizer?.claims?.sub 
  });

  try {
    // Get user from Cognito authorizer
    const user = event.requestContext.authorizer?.claims;
    if (!user?.sub || !user?.email) {
      console.log('Unauthorized request - missing user claims');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    console.log('Fetching stripe customer ID for user:', user.sub);
    // Get stripeCustomerId from DynamoDB
    let stripeCustomerId: string | null = null;
    try {
      const { Item } = await docClient.send(new GetCommand({
        TableName: CUSTOMER_TABLE,
        Key: {
          userId: user.sub
        }
      }));
      
      console.log('DynamoDB lookup result:', { 
        hasCustomerId: !!Item?.stripeCustomerId,
        email: Item?.email 
      });
      stripeCustomerId = Item?.stripeCustomerId ?? null;
    } catch (error) {
      console.error('DynamoDB get error:', error);
    }

    // Create new Stripe customer if doesn't exist
    if (!stripeCustomerId) {
      console.log('Creating new Stripe customer for user:', user.sub);
      let newCustomer: Stripe.Customer;
      try {
        newCustomer = await stripe.customers.create({
          email: user.email,
          metadata: {
            userId: user.sub,
          },
        });
        console.log('Successfully created Stripe customer:', newCustomer.id);
      } catch (error) {
        console.error('Failed to create Stripe customer:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to create stripe customer' })
        };
      }

      console.log('Storing new customer ID in DynamoDB');
      // Store the customer ID
      await docClient.send(new PutCommand({
        TableName: CUSTOMER_TABLE,
        Item: {
          userId: user.sub,
          stripeCustomerId: newCustomer.id,
          email: user.email,
          createdAt: new Date().toISOString()
        }
      }));

      stripeCustomerId = newCustomer.id;
    }

    console.log('Creating checkout session for customer:', stripeCustomerId);
    // Create checkout session
    const checkout = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_URL}/success`,
      cancel_url: `${process.env.APP_URL}/subscribe`,
    });

    console.log('Successfully created checkout session:', checkout.id);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': process.env.APP_URL as string,
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ url: checkout.url })
    };

  } catch (error) {
    console.error('Checkout error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create checkout session' })
    };
  }
};
