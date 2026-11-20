const LEGACY_STORAGE_KEY = "dsa-pattern-tracker-v2";
const SET_SIZE = 4;
const DAILY_REV = 4;
const PROGRESS_API = "/api/progress";

const PATTERN_ORDER = Object.keys(TRACKER_DATA.patterns);

let state = null;
let saveTimer = null;
let saveStatus = "saved";

function defaultState() {
  return {
    version: 3,
    problems: {},
    weak: {},
    solutions: {},
    currentSet: [],
    revision: [],
    revisionDate: null,
    setHistory: [],
    history: {},
    streak: 0,
    lastActiveDate: null,
  };
}

function normalizeState(raw) {
  const initial = defaultState();
  if (!raw || typeof raw !== "object") return initial;
  initial.problems = raw.problems || {};
  initial.weak = raw.weak || {};
  initial.solutions = raw.solutions || {};
  initial.currentSet = Array.isArray(raw.currentSet) ? raw.currentSet.slice(0, SET_SIZE) : [];
  initial.revision = Array.isArray(raw.revision) ? raw.revision : [];
  initial.revisionDate = raw.revisionDate || null;
  initial.setHistory = Array.isArray(raw.setHistory) ? raw.setHistory : [];
  initial.history = raw.history || {};
  initial.streak = raw.streak || 0;
  initial.lastActiveDate = raw.lastActiveDate || null;
  return initial;
}

function migrateLegacyLocalStorage() {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const old = JSON.parse(raw);
    const today = todayKey();
    const plan = old.dailyPlans?.[today];
    return normalizeState({
      version: 3,
      problems: old.problems,
      weak: old.weak,
      solutions: old.solutions,
      currentSet: plan?.new?.slice(0, SET_SIZE) || [],
      revision: plan?.revision || [],
      revisionDate: plan ? today : null,
      setHistory: [],
      history: old.history,
      streak: old.streak,
      lastActiveDate: old.lastActiveDate,
    });
  } catch {
    return null;
  }
}

async function loadState() {
  try {
    const res = await fetch(PROGRESS_API, { cache: "no-store" });
    if (!res.ok) throw new Error("bad response");
    const data = normalizeState(await res.json());
    const legacy = migrateLegacyLocalStorage();
    const empty =
      data.currentSet.length === 0 &&
      Object.keys(data.problems).length === 0 &&
      data.setHistory.length === 0;
    if (empty && legacy) {
      state = legacy;
      await persistState();
      return state;
    }
    state = data;
    return state;
  } catch {
    state = migrateLegacyLocalStorage() || defaultState();
    return state;
  }
}

async function persistState() {
  const res = await fetch(PROGRESS_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error("save failed");
  saveStatus = "saved";
}

function saveState() {
  clearTimeout(saveTimer);
  saveStatus = "saving";
  saveTimer = setTimeout(async () => {
    try {
      await persistState();
    } catch (err) {
      console.error(err);
      saveStatus = "error";
    }
  }, 250);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function problemSearchUrl(title) {
  const query = `(site:leetcode.com OR site:geeksforgeeks.org OR site:codingninjas.com) ${title}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function problemTitleHtml(name) {
  const safe = escapeHtml(name);
  const url = problemSearchUrl(name);
  return `<a class="problem-title-link" href="${url}" target="_blank" rel="noopener noreferrer" title="Google search on LeetCode, GeeksforGeeks, or Coding Ninjas">${safe}</a>`;
}

function isInCurrentSet(id) {
  return state.currentSet.includes(id);
}

function canAddToSet() {
  return state.currentSet.length < SET_SIZE;
}

function addToSet(id) {
  if (!canAddToSet() || isInCurrentSet(id) || isCompleted(id)) return;
  state.currentSet.push(id);
  refreshRevisionPlan();
  saveState();
  render();
}

function removeFromSet(id) {
  state.currentSet = state.currentSet.filter((item) => item !== id);
  refreshRevisionPlan();
  saveState();
  render();
}

function startNewSet() {
  if (state.currentSet.length > 0) {
    state.setHistory.push({
      id: `set-${Date.now()}`,
      createdAt: todayKey(),
      problemIds: [...state.currentSet],
    });
  }
  state.currentSet = [];
  refreshRevisionPlan(true);
  saveState();
  render();
}

function ensureRevision() {
  const date = todayKey();
  if (state.revisionDate !== date) {
    state.revision = pickRevisionProblems(date, state.currentSet);
    state.revisionDate = date;
    saveState();
  }
  return state.revision;
}

function isSkippedSubsection(name) {
  const n = name.toLowerCase();
  return (
    n.startsWith("introduction") ||
    n.startsWith("learn ") ||
    n === "learning" ||
    n === "theory" ||
    n === "concepts"
  );
}

function isPracticeProblem(problem) {
  if (isSkippedSubsection(problem.subsection)) return false;
  const name = problem.name.toLowerCase();
  if (name.includes("| theory") || name.includes("(theory")) return false;
  if (/^introduction to /.test(name)) return false;
  return true;
}

function flattenProblems() {
  const list = [];
  for (const [pattern, subs] of Object.entries(TRACKER_DATA.patterns)) {
    for (const [subsection, problems] of Object.entries(subs)) {
      for (const p of problems) {
        list.push({ ...p, pattern, subsection });
      }
    }
  }
  return list;
}

function getPracticeProblemsForPattern(pattern) {
  return flattenProblems().filter((p) => p.pattern === pattern && isPracticeProblem(p));
}

function getProblemById(id) {
  return flattenProblems().find((p) => p.id === id);
}

function isCompleted(id) {
  return Boolean(state.problems[id]?.completed);
}

function isWeak(id) {
  return Boolean(state.weak?.[id]);
}

function addToWeak(id) {
  if (!state.weak) state.weak = {};
  state.weak[id] = { addedAt: todayKey() };
  saveState();
  refreshRevisionPlan();
  render();
}

function removeFromWeak(id) {
  if (!state.weak) return;
  delete state.weak[id];
  saveState();
  refreshRevisionPlan();
  render();
}

function refreshRevisionPlan(force = false) {
  const date = todayKey();
  if (force || state.revisionDate !== date) {
    state.revision = pickRevisionProblems(date, state.currentSet);
    state.revisionDate = date;
    saveState();
  }
}

function getWeakIds() {
  return Object.keys(state.weak || {});
}

function getCurrentPattern() {
  for (const pattern of PATTERN_ORDER) {
    const remaining = getPracticeProblemsForPattern(pattern).filter((p) => !isCompleted(p.id));
    if (remaining.length > 0) return pattern;
  }
  return null;
}

function patternStats() {
  const stats = {};
  for (const pattern of PATTERN_ORDER) {
    const practice = getPracticeProblemsForPattern(pattern);
    const done = practice.filter((p) => isCompleted(p.id)).length;
    stats[pattern] = { total: practice.length, done, remaining: practice.length - done };
  }
  return stats;
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRevisionProblems(date, excludeIds = []) {
  const exclude = new Set(excludeIds);
  const picked = [];

  const weakCandidates = getWeakIds().filter(
    (id) => isCompleted(id) && !exclude.has(id)
  );
  const weakShuffled = seededShuffle(weakCandidates, hashSeed(`${date}-weak`));
  const weakSlots = Math.min(2, DAILY_REV, weakShuffled.length);
  picked.push(...weakShuffled.slice(0, weakSlots));

  const solved = flattenProblems()
    .filter((p) => isCompleted(p.id) && !exclude.has(p.id) && !picked.includes(p.id))
    .map((p) => p.id);

  if (picked.length < DAILY_REV && solved.length > 0) {
    const shuffled = seededShuffle(solved, hashSeed(`${date}-revision`));
    picked.push(...shuffled.slice(0, DAILY_REV - picked.length));
  }

  return picked;
}

function getCompletedProblems() {
  return flattenProblems()
    .filter(isPracticeProblem)
    .filter((p) => isCompleted(p.id))
    .sort((a, b) => {
      const aDate = state.problems[a.id]?.completedAt || "";
      const bDate = state.problems[b.id]?.completedAt || "";
      return bDate.localeCompare(aDate);
    });
}

function markCompleted(id) {
  const date = todayKey();
  if (!state.problems[id]) {
    state.problems[id] = { completed: true, completedAt: date, revisions: [] };
  } else {
    state.problems[id].completed = true;
    state.problems[id].completedAt = state.problems[id].completedAt || date;
  }

  if (!state.history[date]) state.history[date] = { new: [], revision: [] };
  if (!state.history[date].new.includes(id)) {
    state.history[date].new.push(id);
  }

  updateStreak(date);
  saveState();
  render();
}

function markRevised(id) {
  const date = todayKey();
  if (!state.problems[id]) return;

  if (!state.problems[id].revisions) state.problems[id].revisions = [];
  if (!state.problems[id].revisions.includes(date)) {
    state.problems[id].revisions.push(date);
  }

  if (!state.history[date]) state.history[date] = { new: [], revision: [] };
  if (!state.history[date].revision.includes(id)) {
    state.history[date].revision.push(id);
  }

  updateStreak(date);
  saveState();
  render();
}

function unmarkCompleted(id) {
  delete state.problems[id];

  const date = todayKey();
  if (state.history[date]?.new) {
    state.history[date].new = state.history[date].new.filter((item) => item !== id);
  }

  saveState();
  render();
}

function updateStreak(date) {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = yesterday.toISOString().slice(0, 10);

  if (state.lastActiveDate === date) return;

  if (state.lastActiveDate === yKey) {
    state.streak += 1;
  } else {
    state.streak = 1;
  }
  state.lastActiveDate = date;
}

function overallStats() {
  const all = flattenProblems().filter(isPracticeProblem);
  const done = all.filter((p) => isCompleted(p.id)).length;
  const remaining = all.length - done;
  const daysLeft = Math.ceil(remaining / SET_SIZE);
  const daysLogged = Object.keys(state.history).length;
  return { total: all.length, done, remaining, daysLeft, daysLogged };
}

function problemTags(problem) {
  const diff = (problem.difficulty || "Easy").toLowerCase();
  const sub = problem.subsection || "";
  const subLower = sub.toLowerCase();
  const hideSub =
    subLower === diff ||
    ["easy", "medium", "hard"].includes(subLower);

  const tags = [`<span class="tag ${diff}">${problem.difficulty || "—"}</span>`];
  if (isWeak(problem.id)) tags.push('<span class="tag weak-tag">Weak</span>');
  tags.push(`<span class="tag">${shortPattern(problem.pattern)}</span>`);
  if (!hideSub && sub) tags.push(`<span class="tag">${sub}</span>`);
  return tags.join("");
}

function completedTags(problem) {
  const tags = problemTags(problem);
  const doneAt = state.problems[problem.id]?.completedAt;
  if (doneAt) {
    return `${tags}<span class="tag success-tag">Done ${doneAt}</span>`;
  }
  return tags;
}

function renderProblemRow(problem, mode) {
  const completed = isCompleted(problem.id);
  const entry = state.problems[problem.id];
  const revisedToday = entry?.revisions?.includes(todayKey());
  const weak = isWeak(problem.id);

  const row = document.createElement("div");
  row.className = "problem-row";
  if (mode === "new" && completed) row.classList.add("done");
  if (mode === "completed") row.classList.add("done");
  if (mode === "rev" && revisedToday) row.classList.add("revised-today");
  if (weak) row.classList.add("weak");

  const links = [];
  if (problem.leetcode) links.push(`<a class="link-btn" href="${problem.leetcode}" target="_blank" rel="noopener">LeetCode</a>`);
  if (problem.tuf) links.push(`<a class="link-btn" href="${problem.tuf}" target="_blank" rel="noopener">TUF</a>`);
  if (problem.article) links.push(`<a class="link-btn" href="${problem.article}" target="_blank" rel="noopener">Article</a>`);

  const hasCode = Boolean(state.solutions?.[problem.id]?.code);
  let actions = links.join("");
  actions += `<button class="action-btn code-btn${hasCode ? " has-code" : ""}" data-action="code" data-id="${problem.id}" title="Open Java editor">Java</button>`;
  if (weak) {
    actions += `<button class="action-btn weak-btn active" data-action="unweak" data-id="${problem.id}">Remove weak</button>`;
  } else {
    actions += `<button class="action-btn weak-btn" data-action="weak" data-id="${problem.id}">Mark weak</button>`;
  }
  if (mode === "new") {
    actions += `<button class="action-btn" data-action="remove-set" data-id="${problem.id}">Remove</button>`;
    actions += completed
      ? `<button class="action-btn" data-action="uncomplete" data-id="${problem.id}">Undo</button>`
      : `<button class="action-btn primary" data-action="complete" data-id="${problem.id}">Mark done</button>`;
  } else if (mode === "rev") {
    actions += revisedToday
      ? `<span class="tag" style="color:var(--success)">Revised today</span>`
      : `<button class="action-btn warn" data-action="revise" data-id="${problem.id}">Mark revised</button>`;
  } else if (mode === "completed") {
    actions += `<button class="action-btn success" data-action="revise" data-id="${problem.id}">Revise</button>`;
    actions += `<button class="action-btn" data-action="uncomplete" data-id="${problem.id}">Undo</button>`;
  } else if (mode === "weak") {
    if (completed) {
      actions += `<button class="action-btn success" data-action="revise" data-id="${problem.id}">Revise</button>`;
    } else {
      actions += `<button class="action-btn primary" data-action="complete" data-id="${problem.id}">Mark done</button>`;
    }
  } else if (completed) {
    actions += `<button class="action-btn success" data-action="revise" data-id="${problem.id}">Revise</button>`;
    actions += `<button class="action-btn" data-action="uncomplete" data-id="${problem.id}">Undo</button>`;
  } else if (isInCurrentSet(problem.id)) {
    actions += `<button class="action-btn" data-action="remove-set" data-id="${problem.id}">Remove from set</button>`;
    actions += `<button class="action-btn primary" data-action="complete" data-id="${problem.id}">Mark done</button>`;
  } else if (canAddToSet()) {
    actions += `<button class="action-btn primary" data-action="add-set" data-id="${problem.id}">Add to set</button>`;
  } else {
    actions += `<button class="action-btn primary" data-action="complete" data-id="${problem.id}">Mark done</button>`;
  }

  row.innerHTML = `
    <h4 class="problem-title">${problemTitleHtml(problem.name)}</h4>
    <div class="problem-meta">${mode === "completed" ? completedTags(problem) : problemTags(problem)}</div>
    <div class="problem-actions">${actions}</div>
  `;

  row.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === "complete") markCompleted(id);
      if (btn.dataset.action === "uncomplete") unmarkCompleted(id);
      if (btn.dataset.action === "revise") markRevised(id);
      if (btn.dataset.action === "weak") addToWeak(id);
      if (btn.dataset.action === "unweak") removeFromWeak(id);
      if (btn.dataset.action === "add-set") addToSet(id);
      if (btn.dataset.action === "remove-set") removeFromSet(id);
      if (btn.dataset.action === "code") {
        const problem = getProblemById(id);
        if (problem) window.DSAEditor.open(problem);
      }
    });
  });

  return row;
}

function shortPattern(name) {
  return name
    .replace("Solve Problems on ", "")
    .replace("Learn ", "")
    .replace(" [Easy -> Medium -> Hard]", "")
    .replace(/\[.*?\]/g, "")
    .trim()
    .slice(0, 28);
}

function renderToday() {
  if (!state) return;

  const date = todayKey();
  const revision = ensureRevision();
  const stats = overallStats();
  const current = getCurrentPattern();
  const currentStats = current ? patternStats()[current] : null;
  const setIds = state.currentSet;

  document.getElementById("today-date").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const patternEl = document.getElementById("current-pattern");
  const slotsLeft = SET_SIZE - setIds.length;
  if (setIds.length === 0) {
    patternEl.textContent = `Pick up to ${SET_SIZE} problems from Patterns — use “Add to set” on each one`;
  } else if (current) {
    const left = currentStats.total - currentStats.done;
    patternEl.textContent = `Current set: ${setIds.length}/${SET_SIZE} · ${shortPattern(current)} — ${currentStats.done}/${currentStats.total} pattern done`;
  } else {
    patternEl.textContent = `Current set: ${setIds.length}/${SET_SIZE}`;
  }

  document.getElementById("overall-count").textContent = `${stats.done} / ${stats.total}`;
  document.getElementById("overall-bar").style.width = `${stats.total ? (stats.done / stats.total) * 100 : 0}%`;
  document.getElementById("stat-streak").textContent = state.streak;
  document.getElementById("stat-days").textContent = stats.daysLogged;
  document.getElementById("stat-eta").textContent = stats.daysLeft;

  const setDone = setIds.filter((id) => isCompleted(id)).length;
  const revDone = revision.filter((id) => state.problems[id]?.revisions?.includes(date)).length;

  document.getElementById("new-count").textContent = `${setIds.length} / ${SET_SIZE} picked · ${setDone} done`;
  document.getElementById("new-count").className =
    setIds.length === SET_SIZE && setDone === SET_SIZE ? "badge done" : "badge";
  document.getElementById("rev-count").textContent = `${revDone} / ${DAILY_REV}`;
  document.getElementById("rev-count").className = revDone === DAILY_REV ? "badge done" : "badge revision";

  const newList = document.getElementById("new-problems");
  newList.innerHTML = "";
  if (setIds.length === 0) {
    newList.innerHTML = `<div class="empty-state">No problems in your set yet. Open <strong>Patterns</strong> and click <strong>Add to set</strong> (up to ${SET_SIZE}).</div>`;
  } else {
    setIds.forEach((id) => {
      const p = getProblemById(id);
      if (p) newList.appendChild(renderProblemRow(p, "new"));
    });
    if (slotsLeft > 0) {
      const hint = document.createElement("div");
      hint.className = "empty-state";
      hint.style.padding = "1rem";
      hint.innerHTML = `Add ${slotsLeft} more from <strong>Patterns</strong> to fill this set.`;
      newList.appendChild(hint);
    }
  }

  const revList = document.getElementById("rev-problems");
  revList.innerHTML = "";
  if (revision.length === 0) {
    revList.innerHTML = `<div class="empty-state">Solve problems first to get random revisions.</div>`;
  } else {
    revision.forEach((id) => {
      const p = getProblemById(id);
      if (p) {
        const row = renderProblemRow(p, "rev");
        if (isWeak(id)) row.classList.add("weak-today");
        revList.appendChild(row);
      }
    });
  }

  const bars = document.getElementById("pattern-bars");
  bars.innerHTML = "";
  const pstats = patternStats();
  const currentPattern = getCurrentPattern();
  for (const [pattern, s] of Object.entries(pstats)) {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    const row = document.createElement("div");
    row.className = "pattern-bar-row";
    if (pattern === currentPattern) row.style.opacity = "1";
    row.innerHTML = `
      <div class="label" title="${pattern}">${pattern === currentPattern ? "▶ " : ""}${shortPattern(pattern)}</div>
      <div class="bar-wrap"><div class="bar" style="width:${pct}%"></div></div>
      <div class="count">${s.done}/${s.total}</div>
    `;
    bars.appendChild(row);
  }
}

function renderPatternList() {
  const list = document.getElementById("pattern-list");
  list.innerHTML = "";
  const pstats = patternStats();
  const current = getCurrentPattern();
  for (const [pattern, s] of Object.entries(pstats)) {
    const btn = document.createElement("button");
    btn.className = "pattern-item" + (pattern === current ? " current" : "");
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    btn.innerHTML = `<span>${shortPattern(pattern)}</span><span class="pct">${pct}%</span>`;
    btn.addEventListener("click", () => {
      showPattern(pattern);
      switchView("patterns");
    });
    list.appendChild(btn);
  }
}

function showPattern(pattern, filter = "") {
  document.getElementById("pattern-title").textContent = pattern;
  const stats = patternStats()[pattern];
  document.getElementById("pattern-subtitle").textContent = `${stats.done} / ${stats.total} practice problems done`;

  const detail = document.getElementById("pattern-detail");
  detail.innerHTML = "";
  const subs = TRACKER_DATA.patterns[pattern];
  const q = filter.toLowerCase();

  for (const [sub, problems] of Object.entries(subs)) {
    const skipped = isSkippedSubsection(sub);
    const filtered = (q
      ? problems.filter((p) => p.name.toLowerCase().includes(q) || sub.toLowerCase().includes(q))
      : problems
    ).map((p) => ({ ...p, pattern, subsection: sub }));

    const practice = filtered.filter(isPracticeProblem);
    if (practice.length === 0 && !skipped) continue;

    const block = document.createElement("div");
    block.className = "subsection-block";
    const label = skipped ? `${sub} (skipped — intro/learning)` : sub;
    const doneCount = practice.filter((p) => isCompleted(p.id)).length;
    block.innerHTML = `<h3>${label} (${doneCount}/${practice.length})</h3>`;

    const plist = document.createElement("div");
    plist.className = "problem-list";
    if (skipped) {
      plist.innerHTML = `<div class="empty-state">Not included in daily plan</div>`;
    } else {
      practice.forEach((p) => plist.appendChild(renderProblemRow(p, "browse")));
    }
    block.appendChild(plist);
    detail.appendChild(block);
  }
}

function renderWeak() {
  const ids = getWeakIds();
  const navWeak = document.getElementById("nav-weak");
  navWeak.textContent = ids.length ? `Weak (${ids.length})` : "Weak";

  document.getElementById("weak-summary").textContent =
    ids.length === 0
      ? "No weak problems yet — mark any problem or search below to add"
      : `${ids.length} problem${ids.length === 1 ? "" : "s"} marked weak · up to 2 appear in daily revision`;

  const list = document.getElementById("weak-list");
  list.innerHTML = "";

  if (ids.length === 0) {
    list.innerHTML = `<div class="empty-state">Use "Mark weak" on any problem in Today or Patterns, or search above to add one.</div>`;
    return;
  }

  const sorted = ids
    .map((id) => ({ id, addedAt: state.weak[id].addedAt, problem: getProblemById(id) }))
    .filter((x) => x.problem)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));

  sorted.forEach(({ problem }) => {
    list.appendChild(renderProblemRow(problem, "weak"));
  });
}

function renderWeakAddResults(query) {
  const box = document.getElementById("weak-add-results");
  box.innerHTML = "";
  const q = query.trim().toLowerCase();
  if (q.length < 2) return;

  const matches = flattenProblems()
    .filter(isPracticeProblem)
    .filter((p) => !isWeak(p.id))
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.pattern.toLowerCase().includes(q) ||
        p.subsection.toLowerCase().includes(q)
    )
    .slice(0, 8);

  matches.forEach((p) => {
    const row = document.createElement("div");
    row.className = "problem-row";
    row.innerHTML = `
      <h4 class="problem-title">${problemTitleHtml(p.name)}</h4>
      <div class="problem-meta">
        <span class="tag">${shortPattern(p.pattern)}</span>
        <span class="tag">${p.subsection}</span>
      </div>
      <div class="problem-actions">
        <button class="action-btn weak-btn" data-add-weak="${p.id}">Add to weak</button>
      </div>
    `;
    row.querySelector("[data-add-weak]").addEventListener("click", () => {
      addToWeak(p.id);
      document.getElementById("weak-add-search").value = "";
      renderWeakAddResults("");
    });
    box.appendChild(row);
  });
}

function renderHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";
  const dates = Object.keys(state.history).sort().reverse();

  if (dates.length === 0) {
    list.innerHTML = `<div class="empty-state">No activity yet. Start today's plan!</div>`;
    return;
  }

  dates.forEach((date) => {
    const day = state.history[date];
    const div = document.createElement("div");
    div.className = "history-day";
    const newItems = day.new.map((id) => getProblemById(id)?.name || id).join(", ") || "—";
    const revItems = day.revision.map((id) => getProblemById(id)?.name || id).join(", ") || "—";
    div.innerHTML = `
      <h4>${date}</h4>
      <ul>
        <li><strong>New:</strong> ${newItems}</li>
        <li><strong>Revision:</strong> ${revItems}</li>
      </ul>
    `;
    list.appendChild(div);
  });
}

function renderSkipped(filter = "") {
  const q = filter.toLowerCase();
  const list = document.getElementById("skipped-list");
  list.innerHTML = "";

  const groups = [
    { title: "Basics & Sorting (excluded entirely)", reason: "Excluded topic" },
    { title: "Intro / Learning subsections", reason: "Intro/learning subsection" },
    { title: "Theory / Introduction by name", reason: "Intro/theory problem name" },
  ];

  let shown = 0;
  for (const group of groups) {
    const items = SKIPPED_DATA.problems.filter((p) => {
      if (!p.skipReason.startsWith(group.reason)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.pattern.toLowerCase().includes(q) ||
        p.subsection.toLowerCase().includes(q) ||
        p.skipReason.toLowerCase().includes(q)
      );
    });
    if (items.length === 0) continue;

    const block = document.createElement("div");
    block.className = "subsection-block";
    block.innerHTML = `<h3>${group.title} (${items.length})</h3>`;

    const plist = document.createElement("div");
    plist.className = "problem-list";
    items.forEach((p) => {
      const row = document.createElement("div");
      row.className = "problem-row";
      const diff = (p.difficulty || "Easy").toLowerCase();
      row.innerHTML = `
        <div class="problem-info">
          <h4 class="problem-title">${problemTitleHtml(p.name)}</h4>
          <div class="problem-meta">
            <span class="tag ${diff}">${p.difficulty || "—"}</span>
            <span class="tag">${shortPattern(p.pattern)}</span>
            <span class="tag">${p.subsection}</span>
            <span class="tag">${p.skipReason}</span>
          </div>
        </div>
      `;
      plist.appendChild(row);
      shown += 1;
    });
    block.appendChild(plist);
    list.appendChild(block);
  }

  document.getElementById("skipped-summary").textContent =
    `${shown} of ${SKIPPED_DATA.total} skipped problems shown`;
}

function renderCompleted(filter = "") {
  const q = filter.toLowerCase();
  const list = document.getElementById("completed-list");
  list.innerHTML = "";

  const items = getCompletedProblems().filter((p) => {
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.pattern.toLowerCase().includes(q) ||
      p.subsection.toLowerCase().includes(q)
    );
  });

  document.getElementById("completed-summary").textContent =
    items.length
      ? `${items.length} solved problem${items.length === 1 ? "" : "s"}`
      : "No completed problems yet — mark problems done from Today or Patterns";

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">Nothing completed yet. Finish a problem and it will show up here.</div>`;
    return;
  }

  items.forEach((p) => {
    list.appendChild(renderProblemRow(p, "completed"));
  });
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${view}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  if (view === "patterns" && !document.getElementById("pattern-detail").innerHTML) {
    showPattern(getCurrentPattern() || PATTERN_ORDER[0]);
  }
  if (view === "history") renderHistory();
  if (view === "skipped") renderSkipped();
  if (view === "weak") renderWeak();
  if (view === "completed") renderCompleted();
}

function render() {
  if (!state) return;
  renderToday();
  renderPatternList();
  renderWeakNavCount();
  renderCompletedNavCount();
  if (document.getElementById("view-patterns").classList.contains("active")) {
    const title = document.getElementById("pattern-title").textContent;
    showPattern(title, document.getElementById("search").value);
  }
  if (document.getElementById("view-history").classList.contains("active")) {
    renderHistory();
  }
  if (document.getElementById("view-skipped").classList.contains("active")) {
    renderSkipped(document.getElementById("skipped-search").value);
  }
  if (document.getElementById("view-weak").classList.contains("active")) {
    renderWeak();
  }
  if (document.getElementById("view-completed").classList.contains("active")) {
    renderCompleted(document.getElementById("completed-search").value);
  }
}

function renderWeakNavCount() {
  const ids = getWeakIds();
  const navWeak = document.getElementById("nav-weak");
  if (navWeak) navWeak.textContent = ids.length ? `Weak (${ids.length})` : "Weak";
}

function renderCompletedNavCount() {
  const count = getCompletedProblems().length;
  const nav = document.getElementById("nav-completed");
  if (nav) nav.textContent = count ? `Completed (${count})` : "Completed";
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("new-set").addEventListener("click", () => {
  if (state.currentSet.length > 0) {
    const ok = window.confirm("Start a new set? The current set will be saved to history.");
    if (!ok) return;
  }
  startNewSet();
});

document.getElementById("refresh-revision").addEventListener("click", () => {
  refreshRevisionPlan(true);
  render();
});

document.getElementById("search").addEventListener("input", (e) => {
  const pattern = document.getElementById("pattern-title").textContent;
  if (pattern && pattern !== "All patterns") showPattern(pattern, e.target.value);
});

document.getElementById("skipped-search").addEventListener("input", (e) => {
  renderSkipped(e.target.value);
});

document.getElementById("weak-add-search").addEventListener("input", (e) => {
  renderWeakAddResults(e.target.value);
});

document.getElementById("completed-search").addEventListener("input", (e) => {
  renderCompleted(e.target.value);
});

window.DSAEditor.init({
  getSolution(id) {
    return state.solutions[id];
  },
  saveSolution(id, code) {
    state.solutions[id] = { code, updatedAt: todayKey() };
    saveState();
  },
  clearSolution(id) {
    delete state.solutions[id];
    saveState();
    render();
  },
  onClose() {
    render();
  },
});

async function initApp() {
  await loadState();
  render();
}

initApp();
