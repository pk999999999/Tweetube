# Tweetube

Tweetube is a single-container social app for short posts and videos. The Express API serves a responsive web client, with MongoDB for users and content. Creators can register, publish posts, upload media through Cloudinary, comment, like, follow profiles, and search the feed.

## Run locally

Use Node.js 22 or newer and MongoDB 7 or newer. Copy `.env.example` to `.env`, set a random `JWT_SECRET` of at least 32 characters, then run:

```bash
npm ci
npm run dev
```

Visit `http://localhost:8000`. Media uploads require `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Creators can use HTTPS media URLs without Cloudinary.

Run `npm test` for the API integration and browser interaction regression suites. The API tests start and stop an isolated temporary MongoDB instance; the first run downloads a MongoDB binary and needs internet access. To run the client logic tests without a database or download, use `node --test test/client.test.js`. Run `npm run format:check` to check formatting.

## Docker deployment

The Dockerfile builds the app as a non-root Node.js container and checks `/readyz`. Configure your host with:

| Variable                                                               | Purpose                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `MONGODB_URI`                                                          | MongoDB connection string, including database name                                 |
| `JWT_SECRET`                                                           | Random secret, at least 32 characters; keep it private and stable                  |
| `CORS_ORIGIN`                                                          | Comma-separated allowed browser origins, for example `https://your-domain.example` |
| `PORT`                                                                 | Listening port; defaults to `8000`                                                 |
| `TRUST_PROXY`                                                          | Set to `true` only behind one trusted reverse proxy                                |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Optional media uploads                                                             |

Set `NODE_ENV=production` on your host, expose `PORT`, and use `/readyz` as the readiness check. Use HTTPS at the public edge so the secure session cookie works. Back up your MongoDB database and configure persistent storage or a managed MongoDB service.

For a local Docker stack, copy `.env.example` to `.env`, set `JWT_SECRET`, then run `docker compose up --build`. Compose starts a persistent MongoDB volume. Its default `CORS_ORIGIN` is `http://localhost:8000`; change it when you use another origin.

## API

All endpoints below are under `/api/v1`. Responses use JSON. Authentication uses a 12-hour HTTP-only, same-site session cookie. The web client sends it automatically. Unsafe browser requests from unapproved origins are rejected.

| Method             | Path                                            | Description                                                             |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| POST               | `/auth/register`, `/auth/login`, `/auth/logout` | Account sessions                                                        |
| GET                | `/auth/me`                                      | Current profile                                                         |
| GET, POST          | `/posts`                                        | Paginated feed and publishing; `kind=tweet` or `kind=video`, `q` search |
| GET, PATCH, DELETE | `/posts/:id`                                    | Read or manage a post                                                   |
| POST, DELETE       | `/posts/:id/like`                               | Like or unlike                                                          |
| GET, POST          | `/posts/:id/comments`                           | Comments                                                                |
| DELETE             | `/comments/:id`                                 | Remove your comment                                                     |
| GET                | `/users/:username`                              | Public profile and recent posts                                         |
| PATCH              | `/users/me`                                     | Edit your profile                                                       |
| POST, DELETE       | `/users/:username/follow`                       | Follow or unfollow                                                      |
| POST               | `/media`                                        | Upload one image or video as `file` (up to 50 MB)                       |

Health checks are `/healthz` and `/readyz`. The API returns `{ "error": "..." }` for errors. Feed pages are capped at 30 items.

Feed, post, and profile reads include a `liked` boolean for each post. Profiles also include `user.isFollowing`. These reflect the current session and are false for signed-out visitors. Personalized reads use `Cache-Control: private, no-store`; expired sessions can still browse public content. The client restores these states on refresh and supports both liking/unliking and following/unfollowing.

Requests from the app's own origin are accepted automatically. Additional browser origins must be listed in `CORS_ORIGIN`; production still requires this setting.

## Repository layout

- `public/`: browser client, served by the API
- `src/`: Express app, authentication, models, and routes
- `test/`: API integration tests
- `Dockerfile`, `compose.yaml`: container deployment
- `.github/workflows/ci.yml`: tests, formatting, and production dependency audit

The original starter's local-only files are not included in this GitHub version. Never commit `.env` or live credentials.
