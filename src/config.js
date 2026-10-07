const port = Number(process.env.PORT ?? 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

export const config = {
  port,
  mongodbUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigins: (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === "true",
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
};

export function validateConfig() {
  if (!config.mongodbUri) throw new Error("MONGODB_URI is required");
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  if (
    process.env.NODE_ENV === "production" &&
    config.corsOrigins.length === 0
  ) {
    throw new Error("CORS_ORIGIN is required in production");
  }
}
