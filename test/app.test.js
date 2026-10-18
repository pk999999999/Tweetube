import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

process.env.JWT_SECRET = "test-secret-long-enough-for-hmac-signing-123";
process.env.CORS_ORIGIN = "http://localhost:8000";
process.env.MONGOMS_DOWNLOAD_DIR = path.join(
  os.tmpdir(),
  "tweetube-mongo-test-binaries"
);
let mongo;
let app;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  await mongoose.connect(process.env.MONGODB_URI);
  ({ app } = await import("../src/app.js"));
  const { User, Post, Like, Follow } = await import("../src/models.js");
  await Promise.all([User.init(), Post.init(), Like.init(), Follow.init()]);
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("serves the web app and readiness checks", async () => {
  assert.equal((await request(app).get("/healthz")).status, 200);
  assert.equal((await request(app).get("/readyz")).status, 200);
  const page = await request(app).get("/");
  assert.equal(page.status, 200);
  assert.match(page.text, /Tweetube/);
});

test("registration, posting, engagement, and logout", async () => {
  const agent = request.agent(app);
  const register = await agent.post("/api/v1/auth/register").send({
    username: "Creator_1",
    email: "Creator@example.com",
    password: "strongPassword123",
  });
  assert.equal(register.status, 201);
  assert.equal(register.body.user.username, "creator_1");
  assert.equal(register.body.user.passwordHash, undefined);
  assert.equal((await agent.get("/api/v1/auth/me")).status, 200);

  const invalid = await agent
    .post("/api/v1/posts")
    .send({ kind: "video", title: "No media" });
  assert.equal(invalid.status, 400);
  const created = await agent
    .post("/api/v1/posts")
    .send({ kind: "tweet", body: "Hello Tweetube!" });
  assert.equal(created.status, 201);
  const id = created.body.post.id;
  const list = await request(app).get("/api/v1/posts");
  assert.equal(list.body.total, 1);
  assert.equal(list.body.posts[0].body, "Hello Tweetube!");
  assert.equal(
    (await agent.post(`/api/v1/posts/${id}/like`)).body.likeCount,
    1
  );
  assert.equal(
    (await agent.post(`/api/v1/posts/${id}/like`)).body.likeCount,
    1
  );
  assert.equal(
    (await request(app).get(`/api/v1/posts/${id}`)).body.post.likeCount,
    1
  );
  assert.equal(
    (await agent.delete(`/api/v1/posts/${id}/like`)).body.likeCount,
    0
  );
  assert.equal(
    (await agent.post(`/api/v1/posts/${id}/comments`).send({ body: "First!" }))
      .status,
    201
  );
  assert.equal(
    (await request(app).get(`/api/v1/posts/${id}/comments`)).body.comments
      .length,
    1
  );
  assert.equal(
    (await request(app).get("/api/v1/users/creator_1")).body.user.followers,
    0
  );
  assert.equal((await agent.post("/api/v1/auth/logout")).status, 204);
  assert.equal((await agent.get("/api/v1/auth/me")).status, 401);
});

test("rejects untrusted browser origins", async () => {
  const result = await request(app)
    .post("/api/v1/auth/login")
    .set("Origin", "https://attacker.example")
    .send({ email: "nobody@example.com", password: "password123" });
  assert.equal(result.status, 403);
});

test("accepts same-origin requests and configured cross-origin preflights", async () => {
  const sameOrigin = await request(app)
    .post("/api/v1/auth/login")
    .set("Host", "localhost:8123")
    .set("Origin", "http://localhost:8123")
    .send({ email: "nobody@example.com", password: "password123" });
  assert.equal(sameOrigin.status, 401);
  assert.equal(
    sameOrigin.headers["access-control-allow-origin"],
    "http://localhost:8123"
  );
  const preflight = await request(app)
    .options("/api/v1/posts")
    .set("Origin", "http://localhost:8000")
    .set("Access-Control-Request-Method", "POST");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-credentials"], "true");
  const denied = await request(app)
    .options("/api/v1/posts")
    .set("Origin", "https://attacker.example")
    .set("Access-Control-Request-Method", "POST");
  assert.equal(denied.status, 403);
});

test("restores viewer engagement across feed, post and profile reads", async () => {
  const author = request.agent(app);
  const viewer = request.agent(app);
  for (const [agent, username] of [
    [author, "engagement_author"],
    [viewer, "engagement_viewer"],
  ]) {
    const result = await agent.post("/api/v1/auth/register").send({
      username,
      email: `${username}@example.com`,
      password: "strongPassword123",
    });
    assert.equal(result.status, 201);
  }
  const created = await author
    .post("/api/v1/posts")
    .send({ kind: "tweet", body: "Persist my engagement" });
  assert.equal(created.status, 201);
  const id = created.body.post.id;
  assert.equal((await viewer.post(`/api/v1/posts/${id}/like`)).status, 200);
  assert.equal(
    (await viewer.post("/api/v1/users/engagement_author/follow")).status,
    200
  );
  const feed = await viewer.get("/api/v1/posts");
  assert.equal(feed.body.posts.find((post) => post.id === id).liked, true);
  assert.equal(feed.headers["cache-control"], "private, no-store");
  assert.equal((await viewer.get(`/api/v1/posts/${id}`)).body.post.liked, true);
  const profile = await viewer.get("/api/v1/users/engagement_author");
  assert.equal(profile.body.user.isFollowing, true);
  assert.equal(profile.body.user.followers, 1);
  assert.equal(profile.body.posts[0].liked, true);
  assert.equal(
    (await author.get(`/api/v1/posts/${id}`)).body.post.liked,
    false
  );
  const anonymous = await request(app).get("/api/v1/users/engagement_author");
  assert.equal(anonymous.body.user.isFollowing, false);
  assert.equal(anonymous.body.posts[0].liked, false);
  const staleSession = await request(app)
    .get(`/api/v1/posts/${id}`)
    .set("Cookie", "session=invalid-token");
  assert.equal(staleSession.status, 200);
  assert.equal(staleSession.body.post.liked, false);
  assert.equal(
    (await viewer.delete(`/api/v1/posts/${id}/like`)).body.likeCount,
    0
  );
  assert.equal(
    (await viewer.delete("/api/v1/users/engagement_author/follow")).status,
    200
  );
  const unfollowed = await viewer.get("/api/v1/users/engagement_author");
  assert.equal(unfollowed.body.user.isFollowing, false);
  assert.equal(unfollowed.body.user.followers, 0);
  assert.equal(unfollowed.body.posts[0].liked, false);
});

test("enforces ownership and removes a deleted post's comments and likes", async () => {
  const owner = request.agent(app);
  const other = request.agent(app);
  for (const [agent, username] of [
    [owner, "post_owner"],
    [other, "other_user"],
  ]) {
    assert.equal(
      (
        await agent.post("/api/v1/auth/register").send({
          username,
          email: `${username}@example.com`,
          password: "strongPassword123",
        })
      ).status,
      201
    );
  }
  const created = await owner
    .post("/api/v1/posts")
    .send({ kind: "tweet", body: "Original" });
  const id = created.body.post.id;
  assert.equal(
    (await other.patch(`/api/v1/posts/${id}`).send({ body: "Changed" })).status,
    403
  );
  assert.equal((await other.delete(`/api/v1/posts/${id}`)).status, 404);
  assert.equal(
    (await owner.patch(`/api/v1/posts/${id}`).send({ body: "Updated" })).body
      .post.body,
    "Updated"
  );
  await other.post(`/api/v1/posts/${id}/comments`).send({ body: "A reply" });
  await other.post(`/api/v1/posts/${id}/like`);
  assert.equal((await owner.delete(`/api/v1/posts/${id}`)).status, 204);
  assert.equal((await request(app).get(`/api/v1/posts/${id}`)).status, 404);
  const { Comment, Like } = await import("../src/models.js");
  assert.equal(await Comment.countDocuments({ post: id }), 0);
  assert.equal(await Like.countDocuments({ post: id }), 0);
});
