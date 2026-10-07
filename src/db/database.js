import mongoose from "mongoose";
import { config } from "../config.js";

export async function connectDB(uri = config.mongodbUri) {
  if (!uri) throw new Error("MONGODB_URI is required");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`MongoDB connected: ${mongoose.connection.host}`);
  return mongoose.connection;
}
