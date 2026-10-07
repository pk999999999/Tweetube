import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { HttpError, parse, publicUser } from "./http.js";
import { User } from "./models.js";

const router = Router();
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});
const registerSchema = credentials.extend({
  username: z
    .string()
    .regex(
      /^[a-zA-Z0-9_]{3,30}$/,
      "Username must be 3–30 letters, numbers or underscores"
    )
    .transform((value) => value.toLowerCase()),
});
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

function setSession(res, user) {
  if (!config.jwtSecret) throw new Error("JWT_SECRET is required");
  const token = jwt.sign(
    { sub: String(user._id), ver: user.tokenVersion },
    config.jwtSecret,
    { expiresIn: "12h" }
  );
  res.cookie("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
}

export async function requireAuth(req, _res, next) {
  try {
    const bearer = req.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    const token = bearer ?? req.cookies?.session;
    if (!token) throw new HttpError(401, "Sign in required");
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(payload.sub).select("+tokenVersion");
    if (!user || user.tokenVersion !== payload.ver)
      throw new HttpError(401, "Session expired");
    req.user = user;
    next();
  } catch (error) {
    next(
      error instanceof HttpError ? error : new HttpError(401, "Invalid session")
    );
  }
}

router.post("/register", authLimit, async (req, res) => {
  const input = parse(registerSchema, req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({
    username: input.username,
    email: input.email,
    passwordHash,
  });
  setSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post("/login", authLimit, async (req, res) => {
  const input = parse(credentials, req.body);
  const user = await User.findOne({ email: input.email }).select(
    "+passwordHash +tokenVersion"
  );
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }
  setSession(res, user);
  res.json({ user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) =>
  res.json({ user: publicUser(req.user) })
);

router.post("/logout", requireAuth, async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  res.clearCookie("session", { path: "/" });
  res.status(204).end();
});

export default router;
