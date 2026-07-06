const GITHUB_OWNER = "denispacheco-prog";
const GITHUB_REPO = "meus-bookmarks";
const GITHUB_BRANCH = "main";
const GITHUB_FILE_PATH = "data/bookmarks.json";
const TOKEN_STORAGE_KEY = "meusBookmarks.githubToken";
const IMPORT_TAG = "import";

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

function cleanListField(raw) {
  let values = raw;
  if (typeof values === "string") values = values.split(",");
  const seen = [];
  for (const v of values || []) {
    const value = String(v).trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

function mergeKnownCategories(data, newCategories) {
  if (!data.categories) data.categories = [];
  for (const cat of newCategories) {
    if (!data.categories.includes(cat)) data.categories.push(cat);
  }
}

function buildBookmark(raw, extraTags = []) {
  const url = (raw.url || "").trim();
  const title = (raw.title || "").trim();
  if (!url || !title) return null;

  const tags = cleanListField(raw.tags);
  for (const tag of extraTags) {
    if (!tags.includes(tag)) tags.push(tag);
  }

  return {
    id: crypto.randomUUID(),
    url,
    title,
    description: (raw.description || "").trim(),
    tags,
    categories: cleanListField(raw.categories),
    createdAt: new Date().toISOString(),
  };
}

async function ghGetFile() {
  const token = getToken();
  if (!token) throw new Error('Configure seu token do GitHub primeiro (botão "⚙ GitHub").');

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) {
    if (res.status === 401) throw new Error("Token do GitHub inválido ou sem permissão. Reconfigure em \"⚙ GitHub\".");
    throw new Error(`Falha ao ler dados do GitHub (status ${res.status})`);
  }
  const json = await res.json();
  const data = JSON.parse(base64ToUtf8(json.content));
  data.bookmarks = data.bookmarks || [];
  data.categories = data.categories || [];
  return { data, sha: json.sha };
}

async function ghPutFile(data, sha, message) {
  const token = getToken();
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: utf8ToBase64(JSON.stringify(data, null, 2) + "\n"),
        sha,
        branch: GITHUB_BRANCH,
      }),
    }
  );
  if (!res.ok) {
    if (res.status === 409) {
      throw new Error("Os dados mudaram enquanto você editava. Recarregue a página e tente de novo.");
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Falha ao gravar no GitHub (status ${res.status})`);
  }
}

const GitHubApi = {
  mode: "github",
  isConfigured: () => !!getToken(),
  configure: setToken,

  async load() {
    const { data } = await ghGetFile();
    return data;
  },

  async create(payload) {
    const { data, sha } = await ghGetFile();
    const bookmark = buildBookmark(payload);
    if (!bookmark) throw new Error("url e title são obrigatórios");
    data.bookmarks.push(bookmark);
    mergeKnownCategories(data, bookmark.categories);
    await ghPutFile(data, sha, `Adiciona bookmark: ${bookmark.title}`);
    return bookmark;
  },

  async update(id, payload) {
    const { data, sha } = await ghGetFile();
    const target = data.bookmarks.find((b) => b.id === id);
    if (!target) throw new Error("bookmark não encontrado");
    const url = (payload.url || "").trim();
    const title = (payload.title || "").trim();
    if (!url || !title) throw new Error("url e title são obrigatórios");
    target.url = url;
    target.title = title;
    target.description = (payload.description || "").trim();
    target.tags = cleanListField(payload.tags);
    target.categories = cleanListField(payload.categories);
    mergeKnownCategories(data, target.categories);
    await ghPutFile(data, sha, `Edita bookmark: ${title}`);
    return target;
  },

  async remove(id) {
    const { data, sha } = await ghGetFile();
    const before = data.bookmarks.length;
    data.bookmarks = data.bookmarks.filter((b) => b.id !== id);
    if (data.bookmarks.length === before) throw new Error("bookmark não encontrado");
    await ghPutFile(data, sha, `Remove bookmark ${id}`);
    return { deleted: id };
  },

  async import(payload) {
    const { data, sha } = await ghGetFile();
    const rawItems = Array.isArray(payload) ? payload : payload.bookmarks;
    if (!Array.isArray(rawItems)) {
      throw new Error('esperava um array de bookmarks (ou {"bookmarks": [...]})');
    }
    const existingUrls = new Set(data.bookmarks.map((b) => b.url));
    const imported = [];
    let skipped = 0;
    let invalid = 0;

    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") {
        invalid++;
        continue;
      }
      const bookmark = buildBookmark(raw, [IMPORT_TAG]);
      if (!bookmark) {
        invalid++;
        continue;
      }
      if (existingUrls.has(bookmark.url)) {
        skipped++;
        continue;
      }
      existingUrls.add(bookmark.url);
      imported.push(bookmark);
      mergeKnownCategories(data, bookmark.categories);
    }

    data.bookmarks.push(...imported);
    if (imported.length > 0) {
      await ghPutFile(data, sha, `Importa ${imported.length} bookmark(s)`);
    }

    return { importedCount: imported.length, skippedCount: skipped, invalidCount: invalid, imported };
  },
};

const LocalApi = {
  mode: "local",
  isConfigured: () => true,
  configure: () => {},

  async load() {
    const res = await fetch("/api/bookmarks");
    if (!res.ok) throw new Error("Falha ao carregar bookmarks");
    return res.json();
  },

  async create(payload) {
    const res = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Erro ao salvar bookmark");
    }
    return res.json();
  },

  async update(id, payload) {
    const res = await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Erro ao salvar edição");
    }
    return res.json();
  },

  async remove(id) {
    const res = await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Erro ao remover bookmark");
    }
    return res.json();
  },

  async import(payload) {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Erro ao importar");
    }
    return res.json();
  },
};

const Api = isLocal ? LocalApi : GitHubApi;
