import { env } from "./config/env.js";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { startTunnel } from "./tunnel.js";

const PORT = env.PORT;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      startTunnel(PORT);
    });
  } catch (err) {
    console.error("Failed to connect to PostgreSQL:", err.message);
    process.exit(1);
  }
};
 
startServer();
