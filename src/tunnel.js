// Gives this local server a public https URL using ngrok, so outside services
// (like Razorpay webhooks) can reach it. Development only: never set NGROK_AUTHTOKEN in production.
import ngrok from "@ngrok/ngrok";
import { env } from "./config/env.ts";
import { logger } from "./config/logger.js";

export const startTunnel = async (port) => {

  // A real server already has a public address, so the tunnel is for development only
  if (!env.NGROK_AUTHTOKEN || env.NODE_ENV === "production") {
    return null;
  }

  try {
    const listener = await ngrok.forward({
      addr: port,
      authtoken: env.NGROK_AUTHTOKEN,
      // A free static domain keeps the same URL across restarts
      ...(env.NGROK_DOMAIN && { domain: env.NGROK_DOMAIN })
    });

    const url = listener.url();
    logger.info({ url, razorpayWebhookUrl: `${url}/webhooks/razorpay` }, "ngrok tunnel open");
    return url;
  } catch (err) {
    // ngrok's error text can include the authtoken itself, so mask it before logging.
    // The app still works locally without the tunnel, so warn instead of crashing.
    const reason = err.message.split(env.NGROK_AUTHTOKEN).join("[REDACTED]");
    logger.warn({ reason }, "Could not start the ngrok tunnel");
    return null;
  }
};
