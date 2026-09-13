// Renders docs/data/papers.json as a card grid with topic tabs, search,
// a random-paper picker, a browser-local "mark to hide" list, and an
// in-page button to trigger the repo's fetch workflow via the GitHub API.
//
// All paper content (title/abstract/authors) comes from an external RSS
// feed, so it's inserted via textContent, never innerHTML, to stay XSS-safe.

const GITHUB_OWNER = "Anirudh-C";
const GITHUB_REPO = "eprint-scrawler";
const WORKFLOW_FILE = "update.yml";
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

const TOKEN_STORAGE_KEY = "eprint-scrawler:gh-token";
const MARKED_STORAGE_KEY = "eprint-scrawler:marked-ids";

const state = {
  papers: [],
  activeTopic: "All",
  search: "",
  markedIds: loadMarkedIds(),
  showMarkedView: false,
  lastRandomId: null,
  updateInFlight: false,
  pendingAction: null, // a zero-arg fn to resume once a token has been saved
};

const els = {
  controls: document.getElementById("controls"),
  tabs: document.getElementById("tabs"),
  search: document.getElementById("search"),
  markedToggle: document.getElementById("marked-toggle"),
  list: document.getElementById("paper-list"),
  empty: document.getElementById("empty-state"),
  updatedAt: document.getElementById("updated-at"),
  actionStatus: document.getElementById("action-status"),
  randomBtn: document.getElementById("random-btn"),
  updateBtn: document.getElementById("update-btn"),
  tokenBtn: document.getElementById("token-btn"),
  randomModal: document.getElementById("random-modal"),
  randomModalBody: document.getElementById("random-modal-body"),
  randomAgainBtn: document.getElementById("random-again-btn"),
  tokenModal: document.getElementById("token-modal"),
  tokenForm: document.getElementById("token-form"),
  tokenInput: document.getElementById("token-input"),
  tokenStatus: document.getElementById("token-status"),
  tokenClearBtn: document.getElementById("token-clear-btn"),
};

wireStaticEvents();
init();

async function init() {
  try {
    const res = await fetch("data/papers.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    state.papers = payload.papers || [];
    renderUpdatedAt(payload.updated_at);
  } catch (err) {
    els.updatedAt.textContent = "Couldn't load paper data.";
    console.error("Failed to load papers.json", err);
  }

  els.search.addEventListener("input", () => {
    state.search = els.search.value.trim().toLowerCase();
    render();
  });

  render();
}

async function reloadPapers() {
  const res = await fetch(`data/papers.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  state.papers = payload.papers || [];
  renderUpdatedAt(payload.updated_at);
  render();
}

function renderUpdatedAt(iso) {
  if (!iso) {
    els.updatedAt.textContent = "";
    return;
  }
  const d = new Date(iso);
  els.updatedAt.textContent = `Last updated ${d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })}.`;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function render() {
  renderMarkedToggle();
  els.controls.hidden = state.showMarkedView;
  if (state.showMarkedView) {
    renderMarkedList();
  } else {
    renderTabs();
    renderList();
  }
}

function unmarkedPapers() {
  return state.papers.filter((p) => !state.markedIds.has(p.id));
}

function topicList(pool) {
  const seen = new Set();
  for (const p of pool) {
    for (const t of p.topics || []) seen.add(t);
  }
  const withoutUncategorized = [...seen].filter((t) => t !== "Uncategorized").sort();
  const ordered = [...withoutUncategorized];
  if (seen.has("Uncategorized")) ordered.push("Uncategorized");
  return ["All", ...ordered];
}

function renderTabs() {
  const pool = unmarkedPapers();
  els.tabs.textContent = "";
  for (const topic of topicList(pool)) {
    const count =
      topic === "All" ? pool.length : pool.filter((p) => (p.topics || []).includes(topic)).length;

    const btn = document.createElement("button");
    btn.className = "tab-btn" + (topic === state.activeTopic ? " active" : "");
    btn.type = "button";
    btn.textContent = `${topic} (${count})`;
    btn.addEventListener("click", () => {
      state.activeTopic = topic;
      render();
    });
    els.tabs.appendChild(btn);
  }
}

function matchesSearch(paper) {
  if (!state.search) return true;
  const haystack = [paper.title, paper.abstract, ...(paper.authors || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.search);
}

function setEmptyMessage(text) {
  els.empty.textContent = text;
  els.empty.hidden = !text;
}

function renderList() {
  const filtered = unmarkedPapers().filter(
    (p) =>
      (state.activeTopic === "All" || (p.topics || []).includes(state.activeTopic)) &&
      matchesSearch(p)
  );

  els.list.textContent = "";
  setEmptyMessage(filtered.length === 0 ? "No papers match." : "");
  for (const paper of filtered) {
    els.list.appendChild(renderCard(paper, { marked: false }));
  }
}

function renderMarkedList() {
  const marked = state.papers.filter((p) => state.markedIds.has(p.id));
  els.list.textContent = "";
  setEmptyMessage(marked.length === 0 ? "No marked papers." : "");
  for (const paper of marked) {
    els.list.appendChild(renderCard(paper, { marked: true }));
  }
}

function renderCard(paper, { marked }) {
  const li = document.createElement("li");
  li.className = "paper-card";

  const topRow = document.createElement("div");
  topRow.className = "card-top";

  const h2 = document.createElement("h2");
  const link = document.createElement("a");
  link.href = paper.link || "#";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = paper.title || "(untitled)";
  h2.appendChild(link);
  topRow.appendChild(h2);

  const markBtn = document.createElement("button");
  markBtn.type = "button";
  markBtn.className = "mark-btn";
  markBtn.textContent = marked ? "Unmark" : "Mark";
  markBtn.setAttribute("aria-label", marked ? "Unmark this paper" : "Mark this paper to hide it");
  markBtn.addEventListener("click", () => {
    if (marked) unmarkPaper(paper.id);
    else markPaper(paper.id);
  });
  topRow.appendChild(markBtn);

  li.appendChild(topRow);

  const meta = document.createElement("div");
  meta.className = "paper-meta";
  const parts = [];
  if (paper.authors && paper.authors.length) parts.push(paper.authors.join(", "));
  parts.push(formatDate(paper));
  if (paper.iacr_category) parts.push(paper.iacr_category);
  meta.textContent = parts.join(" · ");
  li.appendChild(meta);

  const abstract = document.createElement("p");
  abstract.className = "paper-abstract";
  const full = paper.abstract || "";
  const isLong = full.length > 320;
  abstract.textContent = isLong ? full.slice(0, 320).trimEnd() + "…" : full;
  li.appendChild(abstract);

  if (isLong) {
    let expanded = false;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "show-more";
    toggle.textContent = "Show more";
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      abstract.textContent = expanded ? full : full.slice(0, 320).trimEnd() + "…";
      toggle.textContent = expanded ? "Show less" : "Show more";
    });
    li.appendChild(toggle);
  }

  const tagRow = document.createElement("div");
  tagRow.className = "tag-row";
  for (const topic of paper.topics || []) {
    const tag = document.createElement("span");
    tag.className = "tag topic";
    tag.textContent = topic;
    tagRow.appendChild(tag);
  }
  li.appendChild(tagRow);

  return li;
}

function formatDate(paper) {
  if (paper.pub_date_iso) {
    return new Date(paper.pub_date_iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return paper.pub_date || "unknown date";
}

// ---------------------------------------------------------------------
// Mark / unmark (browser-local only — localStorage, no repo write)
// ---------------------------------------------------------------------

function loadMarkedIds() {
  try {
    const raw = localStorage.getItem(MARKED_STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveMarkedIds() {
  try {
    localStorage.setItem(MARKED_STORAGE_KEY, JSON.stringify([...state.markedIds]));
  } catch {
    // localStorage unavailable (private mode, disabled, quota) — degrade
    // gracefully: marking still works for this render, just won't persist.
  }
}

function markPaper(id) {
  state.markedIds.add(id);
  saveMarkedIds();
  render();
}

function unmarkPaper(id) {
  state.markedIds.delete(id);
  saveMarkedIds();
  render();
}

function renderMarkedToggle() {
  const n = state.markedIds.size;
  if (state.showMarkedView) {
    els.markedToggle.hidden = false;
    els.markedToggle.textContent = "← Back to all papers";
  } else {
    els.markedToggle.hidden = n === 0;
    els.markedToggle.textContent = `Marked (${n}) — show`;
  }
}

// ---------------------------------------------------------------------
// Random paper modal
// ---------------------------------------------------------------------

function pickRandomPaper() {
  const pool = unmarkedPapers();
  if (!pool.length) return null;
  if (pool.length === 1) {
    state.lastRandomId = pool[0].id;
    return pool[0];
  }
  let choice;
  do {
    choice = pool[Math.floor(Math.random() * pool.length)];
  } while (choice.id === state.lastRandomId);
  state.lastRandomId = choice.id;
  return choice;
}

function openRandomModal() {
  const paper = pickRandomPaper();
  if (!paper) {
    setStatus("No papers to pick from yet.");
    return;
  }
  renderRandomModalBody(paper);
  els.randomModal.showModal();
}

function renderRandomModalBody(paper) {
  els.randomModalBody.textContent = "";

  const h2 = document.createElement("h2");
  const link = document.createElement("a");
  link.href = paper.link || "#";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = paper.title || "(untitled)";
  h2.appendChild(link);
  els.randomModalBody.appendChild(h2);

  const meta = document.createElement("div");
  meta.className = "paper-meta";
  const parts = [];
  if (paper.authors && paper.authors.length) parts.push(paper.authors.join(", "));
  parts.push(formatDate(paper));
  if (paper.iacr_category) parts.push(paper.iacr_category);
  meta.textContent = parts.join(" · ");
  els.randomModalBody.appendChild(meta);

  const abstract = document.createElement("p");
  abstract.className = "paper-abstract";
  abstract.textContent = paper.abstract || "";
  els.randomModalBody.appendChild(abstract);

  const tagRow = document.createElement("div");
  tagRow.className = "tag-row";
  for (const topic of paper.topics || []) {
    const tag = document.createElement("span");
    tag.className = "tag topic";
    tag.textContent = topic;
    tagRow.appendChild(tag);
  }
  els.randomModalBody.appendChild(tagRow);
}

// ---------------------------------------------------------------------
// GitHub token (update button only — marking never needs this)
// ---------------------------------------------------------------------

function getToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveToken(token) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore — the token just won't persist across reloads
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function hasToken() {
  return !!getToken();
}

function openTokenModal() {
  els.tokenInput.value = "";
  els.tokenStatus.textContent = hasToken()
    ? "A token is currently saved in this browser."
    : "No token saved yet.";
  els.tokenModal.showModal();
}

// ---------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghRequest(path, options = {}) {
  const token = getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.message) message = body.message;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    const err = new Error(message);
    err.status = res.status;
    err.rateLimited = res.headers.get("x-ratelimit-remaining") === "0";
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

function dispatchUpdateWorkflow() {
  return ghRequest(`/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main" }),
  });
}

async function findRunAfter(sinceIso, { attempts = 10, intervalMs = 3000 } = {}) {
  const sinceMs = Date.parse(sinceIso);
  for (let i = 0; i < attempts; i++) {
    const data = await ghRequest(
      `/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`
    );
    const candidates = (data.workflow_runs || [])
      .filter((r) => Date.parse(r.created_at) > sinceMs)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    if (candidates.length) return candidates[0];
    await sleep(intervalMs);
  }
  return null;
}

function getWorkflowRun(runId) {
  return ghRequest(`/actions/runs/${runId}`);
}

async function pollRunUntilComplete(runId, { attempts = 40, intervalMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const run = await getWorkflowRun(runId);
    if (run.status === "completed") return run;
    await sleep(intervalMs);
  }
  return null;
}

// ---------------------------------------------------------------------
// Update Now
// ---------------------------------------------------------------------

function setStatus(message) {
  els.actionStatus.textContent = message;
  els.actionStatus.hidden = !message;
}

function setUpdateBusy(busy) {
  els.updateBtn.disabled = busy;
  els.updateBtn.classList.toggle("busy", busy);
}

async function handleUpdateClick() {
  if (state.updateInFlight) return;

  if (!hasToken()) {
    state.pendingAction = handleUpdateClick;
    openTokenModal();
    return;
  }

  state.updateInFlight = true;
  setUpdateBusy(true);
  setStatus("Dispatching update…");

  try {
    const preDispatch = new Date().toISOString();
    await dispatchUpdateWorkflow();

    setStatus("Waiting for the run to start…");
    const run = await findRunAfter(preDispatch);
    if (!run) {
      setStatus("Dispatched, but couldn't find the new run — check the Actions tab.");
      return;
    }

    setStatus("Update running…");
    const finished = await pollRunUntilComplete(run.id);
    if (!finished) {
      setStatus("Still running — check the Actions tab for progress.");
      return;
    }

    if (finished.conclusion !== "success") {
      setStatus(`Run finished with status "${finished.conclusion}" — check the Actions tab.`);
      return;
    }

    setStatus("Refreshing…");
    await reloadPapers();
    setStatus("Updated.");
    setTimeout(() => setStatus(""), 4000);
  } catch (err) {
    handleApiError(err);
  } finally {
    state.updateInFlight = false;
    setUpdateBusy(false);
  }
}

function handleApiError(err) {
  if (err.status === 401) {
    setStatus("Token rejected — please re-enter it.");
    state.pendingAction = handleUpdateClick;
    openTokenModal();
  } else if (err.rateLimited) {
    setStatus("Rate limited by GitHub — try again in a few minutes.");
  } else if (err.status === 403) {
    setStatus(`Permission error: ${err.message}`);
  } else if (err.status) {
    setStatus(`GitHub API error: ${err.message}`);
  } else {
    setStatus("Network error contacting GitHub — check your connection.");
  }
  console.error(err);
}

// ---------------------------------------------------------------------
// Static event wiring
// ---------------------------------------------------------------------

function wireStaticEvents() {
  els.randomBtn.addEventListener("click", openRandomModal);
  els.randomAgainBtn.addEventListener("click", () => {
    const paper = pickRandomPaper();
    if (paper) renderRandomModalBody(paper);
  });
  els.randomModal.addEventListener("click", (e) => {
    if (e.target === els.randomModal) els.randomModal.close();
  });

  els.markedToggle.addEventListener("click", () => {
    state.showMarkedView = !state.showMarkedView;
    render();
  });

  els.updateBtn.addEventListener("click", handleUpdateClick);

  els.tokenBtn.addEventListener("click", () => openTokenModal());
  els.tokenForm.addEventListener("submit", () => {
    const value = els.tokenInput.value.trim();
    const action = state.pendingAction;
    state.pendingAction = null;
    if (value) {
      saveToken(value);
      if (action) action();
    }
  });
  els.tokenClearBtn.addEventListener("click", () => {
    clearToken();
    els.tokenStatus.textContent = "Token cleared.";
  });
  els.tokenModal.addEventListener("click", (e) => {
    if (e.target === els.tokenModal) els.tokenModal.close();
  });
  // Esc/backdrop dismissal doesn't fire "submit" — make sure a queued
  // pendingAction (from clicking Update Now with no token yet) doesn't
  // linger and fire later against an unrelated token save.
  els.tokenModal.addEventListener("close", () => {
    state.pendingAction = null;
  });
}
