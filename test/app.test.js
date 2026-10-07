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
