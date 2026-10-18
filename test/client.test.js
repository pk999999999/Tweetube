import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../public/app.js", import.meta.url),
  "utf8"
);

class Element {
  children = [];
  listeners = {};
  attributes = {};
  value = "";
  files = [];
  hidden = false;
  disabled = false;
  classList = { toggle() {} };
  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  get childElementCount() {
    return this.children.length;
  }
}

async function client(fetch) {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return new Element();
    },
    createTextNode(text) {
      return { textContent: text };
    },
    addEventListener() {},
  };
  document.querySelector('input[name="kind"]:checked').value = "tweet";
  const context = vm.createContext({
    document,
    window: { addEventListener() {} },
    location: { hash: "" },
    URLSearchParams,
    FormData,
    fetch,
  });
  await vm
    .runInContext(
      `(async () => { ${source}
    await loadFeed();
    return { loadFeed, showProfile, renderPost, state, setUser, updateComposer };
  })()`,
      context
    )
    .then((api) => {
      context.client = api;
    });
  return {
    ...context.client,
    element: (selector) => document.querySelector(selector),
  };
}

const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const feedResponse = (posts = [], pages = 1) =>
  response({ posts, pages, total: posts.length });
const post = (id, liked = false) => ({
  id,
  liked,
  kind: "tweet",
  body: id,
  likeCount: 1,
  commentCount: 0,
  author: { id: "author", username: "creator" },
  createdAt: "2026-01-01",
});

test("a restored liked post can be unliked with its first click", async () => {
  let method;
  const ui = await client(async (url, options) => {
    if (url.endsWith("/auth/me")) return response({}, 401);
    if (url.endsWith("/like")) {
      method = options.method;
      return response({ liked: false, likeCount: 0 });
    }
    return feedResponse();
  });
  ui.setUser({ id: "viewer", username: "viewer" });
  const card = ui.renderPost(post("liked-post", true));
  const like = card.children.at(-1).children[0];
  assert.equal(like.attributes["aria-pressed"], "true");
  await like.listeners.click();
  assert.equal(method, "DELETE");
  assert.equal(like.textContent, "♡ 0");
  assert.equal(like.attributes["aria-pressed"], "false");
  assert.equal(like.disabled, false);
});

test("profile restores following state and allows unfollowing", async () => {
  let method;
  const ui = await client(async (url, options) => {
    if (url.endsWith("/auth/me")) return response({}, 401);
    if (url.endsWith("/follow")) {
      method = options.method;
      return response({ following: false });
    }
    if (url.includes("/users/"))
      return response({
        user: {
          id: "author",
          username: "creator",
          followers: 1,
          following: 0,
          isFollowing: true,
        },
        posts: [],
      });
    return feedResponse();
  });
  ui.setUser({ id: "viewer", username: "viewer" });
  await ui.showProfile("creator");
  const intro = ui.element("#feed").children[0];
  const follow = intro.children.at(-1);
  assert.equal(follow.textContent, "Unfollow");
  await follow.listeners.click();
  assert.equal(method, "DELETE");
  assert.equal(follow.textContent, "Follow");
  assert.equal(intro.children[3].textContent, "0 followers · 0 following");
});

test("an older feed response cannot overwrite the current filter", async () => {
  let pending = false;
  const requests = [];
  const ui = await client(async (url) => {
    if (url.endsWith("/auth/me")) return response({}, 401);
    if (!pending) return feedResponse();
    return new Promise((resolve) => requests.push(resolve));
  });
  pending = true;
  const older = ui.loadFeed();
  ui.state.kind = "video";
  const newer = ui.loadFeed();
  requests[1](feedResponse([post("newer")]));
  await newer;
  const currentCard = ui.element("#feed").children[0];
  requests[0](feedResponse([post("older")]));
  await older;
  assert.equal(ui.element("#feed").children.length, 1);
  assert.equal(ui.element("#feed").children[0], currentCard);
});

test("failed pagination retries the same page instead of skipping it", async () => {
  let fail = true;
  const pages = [];
  const ui = await client(async (url) => {
    if (url.endsWith("/auth/me")) return response({}, 401);
    const page = new URL(url, "http://localhost").searchParams.get("page");
    if (page === "2") {
      pages.push(page);
      if (fail) return response({ error: "Temporary failure" }, 503);
    }
    return feedResponse([post(page)], 3);
  });
  await ui.loadFeed(false);
  assert.equal(ui.state.page, 1);
  assert.equal(ui.element("#loadMore").disabled, false);
  fail = false;
  await ui.loadFeed(false);
  assert.equal(ui.state.page, 2);
  assert.deepEqual(pages, ["2", "2"]);
});

test("composer resets title requirements and accepted media for thoughts", async () => {
  const ui = await client(async (url) =>
    url.endsWith("/auth/me") ? response({}, 401) : feedResponse()
  );
  ui.element('input[name="kind"]:checked').value = "video";
  ui.updateComposer();
  assert.equal(ui.element("#postTitle").required, true);
  assert.equal(ui.element("#mediaFile").accept, "video/*");
  ui.element('input[name="kind"]:checked').value = "tweet";
  ui.updateComposer();
  assert.equal(ui.element("#postTitle").hidden, true);
  assert.equal(ui.element("#postTitle").required, false);
  assert.equal(ui.element("#mediaFile").accept, "image/*");
});
