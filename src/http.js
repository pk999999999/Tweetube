import { z } from "zod";
import mongoose from "mongoose";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      result.error.issues.map((issue) => issue.message).join("; ")
    );
  }
  return result.data;
}

export function objectId(value) {
  if (!mongoose.isValidObjectId(value)) throw new HttpError(400, "Invalid ID");
  return value;
}

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

export function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}
