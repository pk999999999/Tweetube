import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { HttpError, objectId, pageSchema, parse, publicUser } from "./http.js";
import { Comment, Follow, Like, Post, User } from "./models.js";

const router = Router();
const url = z
  .url()
  .refine((value) => value.startsWith("https://"), "Use an HTTPS URL");
const postInput = z
  .object({
    kind: z.enum(["tweet", "video"]),
    body: z.string().trim().max(1000).default(""),
    title: z.string().trim().max(120).default(""),
    mediaUrl: url.optional().or(z.literal("")),
    thumbnailUrl: url.optional().or(z.literal("")),
  })
  .refine(
    (value) => value.kind !== "tweet" || value.body || value.mediaUrl,
    "A tweet needs text or media"
  )
  .refine(
    (value) => value.kind !== "video" || (value.title && value.mediaUrl),
    "A video needs a title and media URL"
  );

function postJson(post) {
  return {
    id: String(post._id),
    kind: post.kind,
    body: post.body,
    title: post.title,
    mediaUrl: post.mediaUrl,
    thumbnailUrl: post.thumbnailUrl,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    author: publicUser(post.author),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

router.get("/posts", async (req, res) => {
  const { page, limit } = parse(pageSchema, req.query);
  const kind = req.query.kind
    ? parse(z.enum(["tweet", "video"]), req.query.kind)
    : undefined;
  const q = req.query.q
    ? parse(z.string().trim().min(1).max(80), req.query.q)
    : undefined;
  const filter = {
    ...(kind ? { kind } : {}),
    ...(q ? { $text: { $search: q } } : {}),
  };
  const [posts, total] = await Promise.all([
    Post.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("author"),
    Post.countDocuments(filter),
  ]);
  res.json({
    posts: posts.map(postJson),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  });
});

router.post("/posts", requireAuth, async (req, res) => {
  const input = parse(postInput, req.body);
  const post = await Post.create({ ...input, author: req.user._id });
  await post.populate("author");
  res.status(201).json({ post: postJson(post) });
});

router.get("/posts/:id", async (req, res) => {
  const post = await Post.findById(objectId(req.params.id)).populate("author");
  if (!post) throw new HttpError(404, "Post not found");
  res.json({ post: postJson(post) });
});

router.patch("/posts/:id", requireAuth, async (req, res) => {
  const id = objectId(req.params.id);
  const existing = await Post.findById(id);
  if (!existing) throw new HttpError(404, "Post not found");
  if (!existing.author.equals(req.user._id))
    throw new HttpError(403, "Not your post");
  const input = parse(postInput, {
    ...existing.toObject(),
    ...req.body,
    kind: existing.kind,
  });
  Object.assign(existing, input);
  await existing.save();
  await existing.populate("author");
  res.json({ post: postJson(existing) });
});

router.delete("/posts/:id", requireAuth, async (req, res) => {
  const id = objectId(req.params.id);
  const post = await Post.findOneAndDelete({ _id: id, author: req.user._id });
  if (!post) throw new HttpError(404, "Post not found or not yours");
  await Promise.all([
    Comment.deleteMany({ post: id }),
    Like.deleteMany({ post: id }),
  ]);
  res.status(204).end();
});

router.post("/posts/:id/like", requireAuth, async (req, res) => {
  const id = objectId(req.params.id);
  if (!(await Post.exists({ _id: id })))
    throw new HttpError(404, "Post not found");
  const result = await Like.updateOne(
    { post: id, user: req.user._id },
    { $setOnInsert: { post: id, user: req.user._id } },
    { upsert: true }
  );
  if (result.upsertedCount)
    await Post.updateOne({ _id: id }, { $inc: { likeCount: 1 } });
  const post = await Post.findById(id).select("likeCount");
  res.json({ liked: true, likeCount: post?.likeCount ?? 0 });
});

router.delete("/posts/:id/like", requireAuth, async (req, res) => {
  const id = objectId(req.params.id);
  const result = await Like.deleteOne({ post: id, user: req.user._id });
  if (result.deletedCount)
    await Post.updateOne({ _id: id }, { $inc: { likeCount: -1 } });
  const post = await Post.findById(id).select("likeCount");
  res.json({ liked: false, likeCount: post?.likeCount ?? 0 });
});

router.get("/posts/:id/comments", async (req, res) => {
  const id = objectId(req.params.id);
  const { page, limit } = parse(pageSchema, req.query);
  const comments = await Comment.find({ post: id })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate("author");
  res.json({
    comments: comments.map((comment) => ({
      id: String(comment._id),
      body: comment.body,
      author: publicUser(comment.author),
      createdAt: comment.createdAt,
    })),
    page,
  });
});

router.post("/posts/:id/comments", requireAuth, async (req, res) => {
  const id = objectId(req.params.id);
  const { body } = parse(
    z.object({ body: z.string().trim().min(1).max(500) }),
    req.body
  );
  if (!(await Post.exists({ _id: id })))
    throw new HttpError(404, "Post not found");
  const comment = await Comment.create({
    post: id,
    author: req.user._id,
    body,
  });
  await Post.updateOne({ _id: id }, { $inc: { commentCount: 1 } });
  res.status(201).json({
    comment: {
      id: String(comment._id),
      body,
      author: publicUser(req.user),
      createdAt: comment.createdAt,
    },
  });
});

router.delete("/comments/:id", requireAuth, async (req, res) => {
  const comment = await Comment.findOneAndDelete({
    _id: objectId(req.params.id),
    author: req.user._id,
  });
  if (!comment) throw new HttpError(404, "Comment not found or not yours");
  await Post.updateOne({ _id: comment.post }, { $inc: { commentCount: -1 } });
  res.status(204).end();
});

router.get("/users/:username", async (req, res) => {
  const user = await User.findOne({
    username: req.params.username.toLowerCase(),
  });
  if (!user) throw new HttpError(404, "User not found");
  const [followers, following, posts] = await Promise.all([
    Follow.countDocuments({ following: user._id }),
    Follow.countDocuments({ follower: user._id }),
    Post.find({ author: user._id })
      .sort({ createdAt: -1 })
      .limit(30)
      .populate("author"),
  ]);
  res.json({
    user: { ...publicUser(user), followers, following },
    posts: posts.map(postJson),
  });
});

router.patch("/users/me", requireAuth, async (req, res) => {
  const input = parse(
    z.object({
      bio: z.string().trim().max(280).optional(),
      avatarUrl: url.optional(),
    }),
    req.body
  );
  Object.assign(req.user, input);
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

router.post("/users/:username/follow", requireAuth, async (req, res) => {
  const user = await User.findOne({
    username: req.params.username.toLowerCase(),
  });
  if (!user) throw new HttpError(404, "User not found");
  if (user._id.equals(req.user._id))
    throw new HttpError(400, "Cannot follow yourself");
  await Follow.updateOne(
    { follower: req.user._id, following: user._id },
    { $setOnInsert: { follower: req.user._id, following: user._id } },
    { upsert: true }
  );
  res.json({ following: true });
});

router.delete("/users/:username/follow", requireAuth, async (req, res) => {
  const user = await User.findOne({
    username: req.params.username.toLowerCase(),
  });
  if (!user) throw new HttpError(404, "User not found");
  await Follow.deleteOne({ follower: req.user._id, following: user._id });
  res.json({ following: false });
});

export default router;
