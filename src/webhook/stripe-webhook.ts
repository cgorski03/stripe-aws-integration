import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  LambdaClient,
  InvokeCommand,
  InvokeCommandInput,
} from "@aws-sdk/client-lambda";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const lambdaClient = new LambdaClient({});

// Events we care about (from the guide)
const allowedEvents: Stripe.Event.Type[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.upcoming",
  "invoice.marked_uncollectible",
  "invoice.payment_succeeded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
];

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const signature = event.headers["stripe-signature"];

    if (!signature) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "No signature provided" }),
      };
    }

    // Verify webhook signature
    const stripeEvent = stripe.webhooks.constructEvent(
      event.body!,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    // Skip if not an event we care about
    if (!allowedEvents.includes(stripeEvent.type)) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ received: true, processed: false }),
      };
    }

    // Get customerId from event
    const { customer: customerId } = stripeEvent.data.object as {
      customer: string;
    };

    if (typeof customerId !== "string") {
      throw new Error("Invalid customer ID in webhook");
    }

    // Prepare the Lambda invoke command
    const invokeCommand: InvokeCommandInput = {
      FunctionName: process.env.STRIPE_SYNC_FUNCTION_NAME!,
      InvocationType: "Event", // async
      Payload: Buffer.from(
        JSON.stringify({
          customerId,
        })
      ),
    };

    // Trigger sync function
    await lambdaClient.send(new InvokeCommand(invokeCommand));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ received: true }),
    };
  } catch (error) {
    console.error("Webhook error:", error);

    return {
      statusCode:
        error instanceof Stripe.errors.StripeSignatureVerificationError
          ? 400
          : 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
