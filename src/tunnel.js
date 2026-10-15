// Gives this local server a public https URL using ngrok, so outside services
// (like Razorpay webhooks) can reach it. Development only: never set NGROK_AUTHTOKEN in production.
import ngrok from "@ngrok/ngrok";
import { env } from "./config/env.js";

export const startTunnel = async (port) => {

  if (!env.NGROK_AUTHTOKEN) {
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
    console.log(`Public URL (ngrok): ${url}`);
    console.log(`Razorpay webhook URL: ${url}/webhooks/razorpay`);
    return url;
  } catch (err) {
    // The app still works locally without the tunnel, so don't crash
    console.error("Could not start the ngrok tunnel:", err.message);
    return null;
  }
};
