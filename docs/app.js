// Renders docs/data/papers.json as topic tabs + a searchable paper list.
// All paper content (title/abstract/authors) comes from an external RSS feed,
// so it's inserted via textContent, never innerHTML, to stay XSS-safe.

const state = {
  papers: [],
  activeTopic: "All",
  search: "",
};

const els = {
  tabs: document.getElementById("tabs"),
  search: document.getElementById("search"),
  list: document.getElementById("paper-list"),
  empty: document.getElementById("empty-state"),
  updatedAt: document.getElementById("updated-at"),
};

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

  renderTabs();
  els.search.addEventListener("input", () => {
    state.search = els.search.value.trim().toLowerCase();
    renderList();
  });
  renderList();
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

function topicList() {
  const seen = new Set();
  for (const p of state.papers) {
    for (const t of p.topics || []) seen.add(t);
  }
  const withoutUncategorized = [...seen].filter((t) => t !== "Uncategorized").sort();
  const ordered = [...withoutUncategorized];
  if (seen.has("Uncategorized")) ordered.push("Uncategorized");
  return ["All", ...ordered];
}

function renderTabs() {
  els.tabs.textContent = "";
  for (const topic of topicList()) {
    const count =
      topic === "All"
        ? state.papers.length
        : state.papers.filter((p) => (p.topics || []).includes(topic)).length;

    const btn = document.createElement("button");
    btn.className = "tab-btn" + (topic === state.activeTopic ? " active" : "");
    btn.type = "button";
    btn.textContent = `${topic} (${count})`;
    btn.addEventListener("click", () => {
      state.activeTopic = topic;
      renderTabs();
      renderList();
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

function renderList() {
  const filtered = state.papers.filter(
    (p) =>
      (state.activeTopic === "All" || (p.topics || []).includes(state.activeTopic)) &&
      matchesSearch(p)
  );

  els.list.textContent = "";
  els.empty.hidden = filtered.length > 0;
  for (const paper of filtered) {
    els.list.appendChild(renderCard(paper));
  }
}

function renderCard(paper) {
  const li = document.createElement("li");
  li.className = "paper-card";

  const h2 = document.createElement("h2");
  const link = document.createElement("a");
  link.href = paper.link || "#";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = paper.title || "(untitled)";
  h2.appendChild(link);
  li.appendChild(h2);

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
