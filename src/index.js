import "dotenv/config";
import mongoose from "mongoose";
import { app } from "./app.js";
import { config, validateConfig } from "./config.js";
import { connectDB } from "./db/database.js";

try {
  validateConfig();
  await connectDB();
  const server = app.listen(config.port, () => {
    console.log(`Tweetube listening on port ${config.port}`);
  });
  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  console.error("Startup failed:", error);
  process.exit(1);
}
