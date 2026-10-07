import mongoose from "mongoose";

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      select: false,
    },
    passwordHash: { type: String, required: true, select: false },
    bio: { type: String, default: "", maxlength: 280 },
    avatarUrl: { type: String, default: "" },
    tokenVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true }
);

const postSchema = new Schema(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ["tweet", "video"],
      required: true,
      index: true,
    },
    body: { type: String, default: "", maxlength: 1000 },
    title: { type: String, default: "", maxlength: 120 },
    mediaUrl: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);
postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ title: "text", body: "text" });

const commentSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: true }
);
commentSchema.index({ post: 1, createdAt: -1 });

const likeSchema = new Schema({
  post: { type: Schema.Types.ObjectId, ref: "Post", required: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
});
likeSchema.index({ post: 1, user: 1 }, { unique: true });

const followSchema = new Schema({
  follower: { type: Schema.Types.ObjectId, ref: "User", required: true },
  following: { type: Schema.Types.ObjectId, ref: "User", required: true },
});
followSchema.index({ follower: 1, following: 1 }, { unique: true });

export const User = model("User", userSchema);
export const Post = model("Post", postSchema);
export const Comment = model("Comment", commentSchema);
export const Like = model("Like", likeSchema);
export const Follow = model("Follow", followSchema);
