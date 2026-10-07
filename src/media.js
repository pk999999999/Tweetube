import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { HttpError } from "./http.js";

const router = Router();
const directory = path.join(os.tmpdir(), "tweetube-uploads");
const upload = multer({
  dest: directory,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    callback(null, /^(image|video)\//.test(file.mimetype));
  },
});

router.post(
  "/media",
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 30 }),
  upload.single("file"),
  async (req, res) => {
    if (!req.file)
      throw new HttpError(400, "An image or video file is required");
    try {
      if (!Object.values(config.cloudinary).every(Boolean)) {
        throw new HttpError(503, "Media uploads are not configured");
      }
      cloudinary.config({
        cloud_name: config.cloudinary.cloudName,
        api_key: config.cloudinary.apiKey,
        api_secret: config.cloudinary.apiSecret,
      });
      const result = await cloudinary.uploader.upload(req.file.path, {
        resource_type: req.file.mimetype.startsWith("video/")
          ? "video"
          : "image",
        folder: "tweetube",
        public_id: randomUUID(),
      });
      res
        .status(201)
        .json({ url: result.secure_url, resourceType: result.resource_type });
    } finally {
      await fs.unlink(req.file.path).catch(() => {});
    }
  }
);

export default router;
