// sync-stripe-data.ts
import { Stripe } from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  QueryCommand,
  PutCommand 
} from '@aws-sdk/lib-dynamodb';
import type { Handler } from 'aws-lambda';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const CUSTOMER_TABLE = (process.env.CUSTOMER_TABLE as string);

// Types
type SyncStripeEvent = {
  stripeCustomerId: string;
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
  success: boolean;
  data?: StripeSubscriptionData;
  error?: string;
};

export const handler: Handler<SyncStripeEvent, LambdaResponse> = async (event) => {
  console.log('Starting stripe data sync for customer:', event.stripeCustomerId);
  
  try {
    const { stripeCustomerId } = event;

    if (!stripeCustomerId) {
      console.warn('Missing stripeCustomerId in event');
      throw new Error('Customer ID is required');
    }

    console.log('Querying DynamoDB for existing user record');
    const { Items } = await docClient.send(new QueryCommand({
      TableName: CUSTOMER_TABLE,
      IndexName: 'stripeCustomerId-index',
      KeyConditionExpression: 'stripeCustomerId = :stripeId',
      ExpressionAttributeValues: {
        ':stripeId': stripeCustomerId
      }
    }));

    console.log('DynamoDB query result:', {
      found: !!Items?.length,
      userId: Items?.[0]?.userId
    });

    const existingUserId = Items?.[0]?.userId;
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
