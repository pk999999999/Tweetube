import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import authRoutes from "./auth.js";
import mediaRoutes from "./media.js";
import apiRoutes from "./routes.js";
import { config } from "./config.js";
import { HttpError } from "./http.js";

export const app = express();
if (config.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "https:"],
        "media-src": ["'self'", "https:"],
        "style-src": ["'self'"],
        "script-src": ["'self'"],
      },
    },
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin))
        return callback(null, true);
      callback(new HttpError(403, "Origin not allowed"));
    },
    credentials: true,
  })
);
app.use((req, _res, next) => {
  const origin = req.get("origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && origin) {
    const ownOrigin = `${req.protocol}://${req.get("host")}`;
    if (origin !== ownOrigin && !config.corsOrigins.includes(origin)) {
      return next(new HttpError(403, "Origin not allowed"));
    }
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/readyz", (_req, res) => {
  if (mongoose.connection.readyState !== 1)
    return res.status(503).json({ status: "unavailable" });
  res.json({ status: "ready" });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", mediaRoutes);
app.use("/api/v1", apiRoutes);
app.use("/api", (_req, _res, next) =>
  next(new HttpError(404, "Endpoint not found"))
);
const publicDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public"
);
app.use(
  express.static(publicDirectory, {
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  })
);
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.join(publicDirectory, "index.html"))
);

app.use((error, _req, res, _next) => {
  let status = error.status ?? error.statusCode ?? 500;
  let message = error.message ?? "Internal server error";
  if (error.code === 11000) {
    status = 409;
    message = "Username or email already exists";
  }
  if (error.name === "CastError") {
    status = 400;
    message = "Invalid ID";
  }
  if (error.code === "LIMIT_FILE_SIZE") {
    status = 413;
    message = "File exceeds 50 MB limit";
  }
  if (status >= 500) {
    console.error(error);
    message = "Internal server error";
  }
  res.status(status).json({ error: message });
});
