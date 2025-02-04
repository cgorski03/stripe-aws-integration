// sync-stripe-data.ts
import { Stripe } from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  QueryCommand,
  PutCommand, 
  GetCommand
} from '@aws-sdk/lib-dynamodb';
import type { Handler } from 'aws-lambda';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const CUSTOMER_TABLE = (process.env.CUSTOMER_TABLE as string);

// Types
type SyncStripeEvent = {
  stripeCustomerId?: string;
  userId?: string;
};

type StripeSubscriptionData = {
  subscriptionId: string | null;
  status: Stripe.Subscription.Status | 'none';
  priceId: string | null;
  currentPeriodEnd: number | null;
  currentPeriodStart: number | null;
  cancelAtPeriodEnd: boolean;
  paymentMethod: {
    brand: string | null;
    last4: string | null;
  } | null;
};


type LambdaResponse = {
  statusCode: number;
  data?: StripeSubscriptionData;
  error?: string;
};

export const handler: Handler<SyncStripeEvent, LambdaResponse> = async (event) => {
  console.log('Starting stripe data sync for customer:', event.stripeCustomerId);
  
  try {
    let { stripeCustomerId, userId } = event;
    // We are either going to be given a stripeCustomerId or a userId
    // If this is called from the webhook function, it would be the stripe customer ID
    // If this is called from the frontend, it would be the userId
    // If neither of these are included, we can't proceed
    if (!stripeCustomerId && !userId) {
      console.error('Cognito user ID or Stripe customer ID is required');
      throw new Error('Customer ID is required');
    }

    console.log('Querying DynamoDB for existing user record');
    let existingUserId = userId;
    if (userId) {
      // Fetch the stripeCustomerId from the DynamoDB table
      const { Item } = await docClient.send(new GetCommand({
        TableName: CUSTOMER_TABLE,
        Key: {
          userId: userId
        }
      }));

      if (!Item?.stripeCustomerId) {
        console.error('No Stripe customer ID found for user:', userId);
        throw new Error('No Stripe customer ID found');
      }
      // Set the stripe customer ID to the one found in the database
      stripeCustomerId = Item.stripeCustomerId;
    } else {
      const { Items } = await docClient.send(new QueryCommand({
        TableName: CUSTOMER_TABLE,
        IndexName: 'stripeCustomerId-index',
        KeyConditionExpression: 'stripeCustomerId = :stripeId',
        ExpressionAttributeValues: {
          ':stripeId': stripeCustomerId
        }
      }));
      existingUserId = Items?.[0]?.userId;
    }
    
    if (!existingUserId) {
      console.error('No user record found for Stripe customer:', stripeCustomerId);
      throw new Error('No user found for this Stripe customer');
    }

    console.log('Fetching subscription data from Stripe');
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      limit: 1,
      status: 'all',
      expand: ['data.default_payment_method'],
    });

    console.log('Stripe subscriptions found:', subscriptions.data.length);
    let subData: StripeSubscriptionData;

    if (subscriptions.data.length === 0) {
      console.log('No active subscriptions found');
      subData = {
        subscriptionId: null,
        status: 'none',
        priceId: null,
        currentPeriodEnd: null,
        currentPeriodStart: null,
        cancelAtPeriodEnd: false,
        paymentMethod: null,
      };
    } else {
      console.log('Processing subscription:', subscriptions.data[0].id);
      const subscription = subscriptions.data[0];
      const paymentMethod = subscription.default_payment_method;

      subData = {
        subscriptionId: subscription.id,
        status: subscription.status,
        priceId: subscription.items.data[0].price.id,
        currentPeriodEnd: subscription.current_period_end,
        currentPeriodStart: subscription.current_period_start,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        paymentMethod:
          paymentMethod && typeof paymentMethod !== 'string'
            ? {
                brand: paymentMethod.card?.brand ?? null,
                last4: paymentMethod.card?.last4 ?? null,
              }
            : null,
      };
    }

    console.log('Updating DynamoDB with latest subscription data');
    await docClient.send(new PutCommand({
      TableName: CUSTOMER_TABLE,
      Item: {
        userId: existingUserId,        // Preserve existing userId
        stripeCustomerId: stripeCustomerId,  // GSI
        ...subData,
        updatedAt: new Date().toISOString(),
      },
    }));

    console.log('Sync completed successfully');
    return {
      success: true,
      data: subData,
    };
  } catch (error) {
    console.error('Stripe sync error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      customerId: event.stripeCustomerId
    });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};
