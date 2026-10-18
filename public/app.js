const $ = (selector) => document.querySelector(selector);
const state = {
  user: null,
  page: 1,
  kind: "all",
  query: "",
  total: 0,
  profile: null,
};
const feed = $("#feed");
let viewRequest = 0;

async function api(path, options = {}) {
  const { body, ...rest } = options;
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...rest,
    headers:
      body && !(body instanceof FormData)
        ? { "Content-Type": "application/json", ...rest.headers }
        : rest.headers,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function status(message = "", error = false) {
  const element = $("#status");
  element.textContent = message;
  element.classList.toggle("error", error);
}

function setUser(user) {
  state.user = user;
  $("#loginButton").hidden = !!user;
  $("#signupButton").hidden = !!user;
  $("#logoutButton").hidden = !user;
  $("#composeForm").hidden = !user;
  $("#sidebarProfile").hidden = !user;
  if (user) {
    $("#sidebarName").textContent = `@${user.username}`;
    $("#sidebarAvatar").textContent = user.username[0];
    $("#composeAvatar").textContent = user.username[0];
  }
}

function avatar(name) {
  const node = document.createElement("span");
  node.className = "avatar";
  node.textContent = name?.[0] || "T";
  return node;
}

function empty(message, detail) {
  const node = document.createElement("div");
  node.className = "empty";
  const title = document.createElement("strong");
  title.textContent = message;
  node.append(title, document.createTextNode(detail));
  return node;
}

function renderPost(post) {
  const card = document.createElement("article");
  card.className = "post-card";
  const header = document.createElement("div");
  header.className = "post-header";
  header.append(avatar(post.author.username));
  const author = document.createElement("div");
  const name = document.createElement("a");
  name.className = "post-author";
  name.href = `#user/${encodeURIComponent(post.author.username)}`;
  name.textContent = `@${post.author.username}`;
  const date = document.createElement("div");
  date.className = "post-date";
  date.textContent = new Date(post.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  author.append(name, date);
  const kind = document.createElement("span");
  kind.className = "post-kind";
  kind.textContent = post.kind;
  header.append(author, kind);
  card.append(header);
  if (post.title) {
    const title = document.createElement("h3");
    title.className = "post-title";
    title.textContent = post.title;
    card.append(title);
  }
  if (post.body) {
    const body = document.createElement("p");
    body.className = "post-body";
    body.textContent = post.body;
    card.append(body);
  }
  if (post.mediaUrl) {
    const media = document.createElement(
      post.kind === "video" ? "video" : "img"
    );
    media.className = "post-media";
    media.src = post.mediaUrl;
    if (post.kind === "video") {
      media.controls = true;
      media.preload = "metadata";
      if (post.thumbnailUrl) media.poster = post.thumbnailUrl;
    } else media.alt = post.body || "Post image";
    card.append(media);
  }
  const actions = document.createElement("div");
  actions.className = "post-actions";
  const like = document.createElement("button");
  like.type = "button";
  let liked = post.liked;
  const updateLike = () => {
    like.textContent = `${liked ? "♥" : "♡"} ${post.likeCount}`;
    like.setAttribute("aria-pressed", String(Boolean(liked)));
    like.setAttribute(
      "aria-label",
      `${liked ? "Unlike" : "Like"} post, ${post.likeCount} likes`
    );
  };
  updateLike();
  like.addEventListener("click", async () => {
    if (!state.user) return openAuth("login");
    like.disabled = true;
    try {
      const result = await api(`/posts/${post.id}/like`, {
        method: liked ? "DELETE" : "POST",
      });
      liked = result.liked;
      post.likeCount = result.likeCount;
      updateLike();
    } catch (error) {
      status(error.message, true);
    } finally {
      like.disabled = false;
    }
  });
  const commentsButton = document.createElement("button");
  commentsButton.type = "button";
  commentsButton.className = "comments-toggle";
  commentsButton.textContent = `◯ ${post.commentCount} Comments`;
  commentsButton.addEventListener("click", () => toggleComments(card, post));
  actions.append(like, commentsButton);
  if (state.user?.id === post.author.id) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      try {
        await api(`/posts/${post.id}`, { method: "DELETE" });
        card.remove();
        status("Post deleted.");
      } catch (error) {
        status(error.message, true);
      }
    });
    actions.append(remove);
  }
  card.append(actions);
  return card;
}

async function toggleComments(card, post) {
  const existing = card.querySelector(".comments");
  if (existing) return existing.remove();
  const section = document.createElement("section");
  section.className = "comments";
  section.textContent = "Loading comments…";
  card.append(section);
  try {
    const { comments } = await api(`/posts/${post.id}/comments`);
    section.replaceChildren();
    if (!comments.length)
      section.append(empty("No comments yet", "Start the conversation."));
    for (const comment of comments) {
      const row = document.createElement("div");
      row.className = "comment";
      const name = document.createElement("strong");
      name.textContent = `@${comment.author.username}`;
      row.append(name, document.createTextNode(comment.body));
      section.append(row);
    }
    const form = document.createElement("form");
    form.className = "comment-form";
    const input = document.createElement("input");
    input.className = "field";
    input.placeholder = state.user ? "Write a comment…" : "Log in to comment";
    input.maxLength = 500;
    input.required = true;
    input.disabled = !state.user;
    const submit = document.createElement("button");
    submit.textContent = "Reply";
    submit.disabled = !state.user;
    form.append(input, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await api(`/posts/${post.id}/comments`, {
          method: "POST",
          body: { body: input.value },
        });
        post.commentCount += 1;
        card.querySelector(".comments-toggle").textContent =
          `◯ ${post.commentCount} Comments`;
        section.remove();
        await toggleComments(card, post);
      } catch (error) {
        status(error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
    section.append(form);
  } catch (error) {
    section.textContent = error.message;
  }
}

async function loadFeed(reset = true) {
  const requestId = ++viewRequest;
  const page = reset ? 1 : state.page + 1;
  const more = $("#loadMore");
  more.disabled = true;
  if (reset) {
    feed.replaceChildren();
    more.hidden = true;
  }
  state.profile = null;
  $("#feedTitle").textContent =
    state.kind === "all"
      ? "For you"
      : state.kind === "video"
        ? "Videos"
        : "Thoughts";
  status("Loading stories…");
  try {
    const params = new URLSearchParams({ page, limit: 12 });
    if (state.kind !== "all") params.set("kind", state.kind);
    if (state.query) params.set("q", state.query);
    const result = await api(`/posts?${params}`);
    if (requestId !== viewRequest) return;
    state.page = page;
    state.total = result.total;
    for (const post of result.posts) feed.append(renderPost(post));
    if (!feed.childElementCount)
      feed.append(empty("Nothing here yet", "Be the first to share a story."));
    $("#resultCount").textContent =
      `${result.total} ${result.total === 1 ? "story" : "stories"}`;
    $("#loadMore").hidden = state.page >= result.pages;
    status();
  } catch (error) {
    if (requestId === viewRequest) status(error.message, true);
  } finally {
    if (requestId === viewRequest) more.disabled = false;
  }
}

async function showProfile(username) {
  const requestId = ++viewRequest;
  $("#loadMore").hidden = true;
  status("Loading profile…");
  try {
    const { user, posts } = await api(`/users/${encodeURIComponent(username)}`);
    if (requestId !== viewRequest) return;
    state.profile = user;
    $("#feedTitle").textContent = `@${user.username}`;
    $("#resultCount").textContent = `${posts.length} recent stories`;
    $("#loadMore").hidden = true;
    feed.replaceChildren();
    const intro = document.createElement("div");
    intro.className = "profile-hero";
    intro.append(avatar(user.username));
    const name = document.createElement("h2");
    name.textContent = `@${user.username}`;
    const bio = document.createElement("p");
    bio.textContent = user.bio || "A Tweetube creator";
    const counts = document.createElement("p");
    counts.textContent = `${user.followers} followers · ${user.following} following`;
    intro.append(name, bio, counts);
    if (state.user && state.user.id !== user.id) {
      const follow = document.createElement("button");
      follow.className = "button primary";
      const updateFollow = () => {
        follow.textContent = user.isFollowing ? "Unfollow" : "Follow";
        follow.setAttribute("aria-pressed", String(user.isFollowing));
        counts.textContent = `${user.followers} followers · ${user.following} following`;
      };
      updateFollow();
      follow.addEventListener("click", async () => {
        follow.disabled = true;
        try {
          const result = await api(
            `/users/${encodeURIComponent(user.username)}/follow`,
            {
              method: user.isFollowing ? "DELETE" : "POST",
            }
          );
          if (result.following !== user.isFollowing)
            user.followers += result.following ? 1 : -1;
          user.isFollowing = result.following;
          updateFollow();
        } catch (error) {
          status(error.message, true);
        } finally {
          follow.disabled = false;
        }
      });
      intro.append(follow);
    }
    feed.append(intro);
    for (const post of posts) feed.append(renderPost(post));
    status();
  } catch (error) {
    if (requestId === viewRequest) status(error.message, true);
  }
}

let authMode = "register";
function openAuth(mode = "register") {
  authMode = mode;
  const login = mode === "login";
  $("#authTitle").textContent = login
    ? "Welcome back."
    : "Join the conversation.";
  $("#authSubtitle").textContent = login
    ? "Log in to keep your story going."
    : "Create your account and start sharing.";
  $("#usernameGroup").hidden = login;
  $("#authUsername").required = !login;
  $("#authUsername").disabled = login;
  $("#authPassword").autocomplete = login ? "current-password" : "new-password";
  $("#authSubmit").textContent = login ? "Log in" : "Create account";
  $("#authSwitchPrompt").textContent = login
    ? "New to Tweetube?"
    : "Already have an account?";
  $("#authSwitch").textContent = login ? "Join now" : "Log in";
  $("#authError").textContent = "";
  if (!$("#authDialog").open) $("#authDialog").showModal();
}

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#authSubmit");
  button.disabled = true;
  try {
    const body = {
      email: $("#authEmail").value,
      password: $("#authPassword").value,
    };
    if (authMode === "register") body.username = $("#authUsername").value;
    const result = await api(`/auth/${authMode}`, { method: "POST", body });
    setUser(result.user);
    $("#authDialog").close();
    $("#authForm").reset();
    status(`Welcome, @${result.user.username}!`);
    if (state.profile) showProfile(state.profile.username);
    else loadFeed();
  } catch (error) {
    $("#authError").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$("#authSwitch").addEventListener("click", () =>
  openAuth(authMode === "login" ? "register" : "login")
);
$("#closeDialog").addEventListener("click", () => $("#authDialog").close());
$("#loginButton").addEventListener("click", () => openAuth("login"));
$("#signupButton").addEventListener("click", () => openAuth("register"));
$("#heroAction").addEventListener("click", () =>
  state.user ? $("#postBody").focus() : openAuth("register")
);
$("#logoutButton").addEventListener("click", async () => {
  try {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    openFeed();
  } catch (error) {
    status(error.message, true);
  }
});
$("#sidebarProfile").addEventListener("click", () => {
  location.hash = `user/${state.user.username}`;
});
$("#loadMore").addEventListener("click", () => loadFeed(false));
function openFeed() {
  if (location.hash) location.hash = "";
  else loadFeed();
}
$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = $("#searchInput").value.trim();
  openFeed();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
  ) {
    event.preventDefault();
    $("#searchInput").focus();
  }
});
for (const button of document.querySelectorAll("[data-feed]"))
  button.addEventListener("click", () => {
    state.kind = button.dataset.feed;
    state.query = "";
    $("#searchInput").value = "";
    document
      .querySelectorAll("[data-feed]")
      .forEach((item) =>
        item.classList.toggle("active", item.dataset.feed === state.kind)
      );
    openFeed();
  });
window.addEventListener("hashchange", () => {
  const username = location.hash.match(/^#user\/([^/]+)$/)?.[1];
  if (username) showProfile(decodeURIComponent(username));
  else loadFeed();
});

const mediaField = $("#postMedia");
function updateComposer() {
  const video =
    document.querySelector('input[name="kind"]:checked').value === "video";
  $("#postTitle").hidden = !video;
  $("#postTitle").required = video;
  $("#mediaFile").accept = video ? "video/*" : "image/*";
  mediaField.placeholder = video
    ? "HTTPS video URL (or upload a file)"
    : "Optional HTTPS image URL";
}
document
  .querySelectorAll('input[name="kind"]')
  .forEach((radio) => radio.addEventListener("change", updateComposer));
updateComposer();
$("#mediaFile").addEventListener("change", () => {
  $("#fileName").textContent = $("#mediaFile").files[0]?.name || "";
});
$("#composeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#composeForm button[type=submit]");
  button.disabled = true;
  try {
    let mediaUrl = mediaField.value.trim();
    const file = $("#mediaFile").files[0];
    const kind = document.querySelector('input[name="kind"]:checked').value;
    if (file) {
      if (!file.type.startsWith(kind === "video" ? "video/" : "image/")) {
        throw new Error(
          kind === "video"
            ? "Choose a video file."
            : "Choose an image file for a thought."
        );
      }
      if (file.size > 50 * 1024 * 1024)
        throw new Error("File exceeds 50 MB limit");
      const data = new FormData();
      data.append("file", file);
      status("Uploading media…");
      mediaUrl = (await api("/media", { method: "POST", body: data })).url;
    }
    const body = {
      kind,
      title: $("#postTitle").value.trim(),
      body: $("#postBody").value.trim(),
      mediaUrl,
    };
    await api("/posts", { method: "POST", body });
    $("#composeForm").reset();
    updateComposer();
    $("#fileName").textContent = "";
    status("Your story is live.");
    openFeed();
  } catch (error) {
    status(error.message, true);
  } finally {
    button.disabled = false;
  }
});

try {
  setUser((await api("/auth/me")).user);
} catch {
  setUser(null);
}
const profile = location.hash.match(/^#user\/([^/]+)$/)?.[1];
if (profile) showProfile(decodeURIComponent(profile));
else loadFeed();
