const state = {
  bookmarks: [],
  categories: [],
  searchText: "",
  activeTag: null,
  activeCategory: "",
  editingId: null,
};

const els = {
  searchInput: document.getElementById("search-input"),
  categoryFilterSelect: document.getElementById("category-filter-select"),
  activeTagFilter: document.getElementById("active-tag-filter"),
  activeFilterTag: document.getElementById("active-filter-tag"),
  clearTagFilterBtn: document.getElementById("clear-tag-filter-btn"),
  list: document.getElementById("bookmark-list"),
  resultsCount: document.getElementById("results-count"),
  emptyState: document.getElementById("empty-state"),
  form: document.getElementById("add-form"),
  urlInput: document.getElementById("url"),
  titleInput: document.getElementById("title"),
  categoriesSelect: document.getElementById("categories"),
  newCategoriesInput: document.getElementById("new-categories"),
  formStatus: document.getElementById("form-status"),
  exportBtn: document.getElementById("export-btn"),
  importBtn: document.getElementById("import-btn"),
  importFileInput: document.getElementById("import-file-input"),
  importStatus: document.getElementById("import-status"),
  githubConfigBtn: document.getElementById("github-config-btn"),
};

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleDateString("pt-BR", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function matchesFilters(bookmark) {
  if (state.activeTag && !bookmark.tags.includes(state.activeTag)) {
    return false;
  }
  if (state.activeCategory && !bookmark.categories.includes(state.activeCategory)) {
    return false;
  }
  if (state.searchText) {
    const haystack = [bookmark.title, bookmark.description, ...bookmark.tags, ...bookmark.categories]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(state.searchText)) {
      return false;
    }
  }
  return true;
}

function categoryOptionsMarkup(selectedCategories) {
  const selected = new Set(selectedCategories);
  return state.categories
    .map(
      (cat) =>
        `<option value="${escapeHtml(cat)}"${selected.has(cat) ? " selected" : ""}>${escapeHtml(cat)}</option>`
    )
    .join("");
}

function renderCategoryOptions() {
  const previousFilterValue = els.categoryFilterSelect.value;
  els.categoryFilterSelect.innerHTML =
    `<option value="">Todas</option>` + categoryOptionsMarkup([]);
  els.categoryFilterSelect.value = state.categories.includes(previousFilterValue)
    ? previousFilterValue
    : "";

  const previouslySelected = Array.from(els.categoriesSelect.selectedOptions).map((opt) => opt.value);
  els.categoriesSelect.innerHTML = categoryOptionsMarkup(previouslySelected);
}

function render() {
  const filtered = state.bookmarks
    .filter(matchesFilters)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  els.activeTagFilter.classList.toggle("hidden", !state.activeTag);
  if (state.activeTag) {
    els.activeFilterTag.textContent = state.activeTag;
  }

  els.resultsCount.textContent =
    `${filtered.length} bookmark${filtered.length === 1 ? "" : "s"}`;
  els.emptyState.classList.toggle("hidden", filtered.length > 0);

  els.list.innerHTML = filtered
    .map((bookmark) =>
      bookmark.id === state.editingId ? editFormMarkup(bookmark) : bookmarkItemMarkup(bookmark)
    )
    .join("");
}

function bookmarkItemMarkup(bookmark) {
  const tagsHtml = bookmark.tags
    .map(
      (tag) => `<button type="button" class="tag-pill${tag === state.activeTag ? " active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
    )
    .join("");

  const categoriesHtml = bookmark.categories
    .map(
      (cat) => `<button type="button" class="category-pill${cat === state.activeCategory ? " active" : ""}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
    )
    .join("");

  return `
    <li class="bookmark-item" data-id="${escapeHtml(bookmark.id)}">
      <h3><a href="${escapeHtml(bookmark.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bookmark.title)}</a></h3>
      <div class="bookmark-url">${escapeHtml(bookmark.url)}</div>
      ${bookmark.description ? `<p class="bookmark-description">${escapeHtml(bookmark.description)}</p>` : ""}
      <div class="bookmark-meta">
        <span class="bookmark-date">${formatDate(bookmark.createdAt)}</span>
        ${categoriesHtml}
        ${tagsHtml}
      </div>
      <div class="bookmark-actions">
        <button type="button" class="edit-btn" data-id="${escapeHtml(bookmark.id)}">Editar</button>
        <button type="button" class="delete-btn" data-id="${escapeHtml(bookmark.id)}">Remover</button>
      </div>
    </li>
  `;
}

function editFormMarkup(bookmark) {
  return `
    <li class="bookmark-item">
      <form class="edit-form" data-id="${escapeHtml(bookmark.id)}">
        <div class="form-row">
          <label>URL *</label>
          <input name="url" type="url" value="${escapeHtml(bookmark.url)}" required />
        </div>
        <div class="form-row">
          <label>Título *</label>
          <input name="title" type="text" value="${escapeHtml(bookmark.title)}" required />
        </div>
        <div class="form-row">
          <label>Descrição</label>
          <textarea name="description" rows="2">${escapeHtml(bookmark.description)}</textarea>
        </div>
        <div class="form-row">
          <label>Tags</label>
          <input name="tags" type="text" value="${escapeHtml(bookmark.tags.join(", "))}" />
        </div>
        <div class="form-row">
          <label>Categorias existentes</label>
          <select name="categories" multiple size="4">${categoryOptionsMarkup(bookmark.categories)}</select>
        </div>
        <div class="form-row">
          <label>Nova(s) categoria(s)</label>
          <input name="new-categories" type="text" placeholder="separadas por vírgula" />
        </div>
        <div class="form-actions">
          <button type="submit">Salvar</button>
          <button type="button" class="cancel-edit-btn">Cancelar</button>
        </div>
      </form>
    </li>
  `;
}

async function loadBookmarks() {
  const data = await Api.load();
  state.bookmarks = (data.bookmarks || []).map((b) => ({ categories: [], ...b }));
  state.categories = data.categories || [];
  renderCategoryOptions();
  render();
}

els.searchInput.addEventListener("input", (e) => {
  state.searchText = e.target.value.trim().toLowerCase();
  render();
});

els.categoryFilterSelect.addEventListener("change", (e) => {
  state.activeCategory = e.target.value;
  render();
});

els.list.addEventListener("click", async (e) => {
  const tagBtn = e.target.closest(".tag-pill");
  if (tagBtn) {
    const tag = tagBtn.dataset.tag;
    state.activeTag = state.activeTag === tag ? null : tag;
    render();
    return;
  }
  const categoryBtn = e.target.closest(".category-pill");
  if (categoryBtn) {
    const category = categoryBtn.dataset.category;
    state.activeCategory = state.activeCategory === category ? "" : category;
    els.categoryFilterSelect.value = state.activeCategory;
    render();
    return;
  }
  const editBtn = e.target.closest(".edit-btn");
  if (editBtn) {
    state.editingId = editBtn.dataset.id;
    render();
    return;
  }
  const cancelBtn = e.target.closest(".cancel-edit-btn");
  if (cancelBtn) {
    state.editingId = null;
    render();
    return;
  }
  const deleteBtn = e.target.closest(".delete-btn");
  if (deleteBtn) {
    const bookmark = state.bookmarks.find((b) => b.id === deleteBtn.dataset.id);
    const label = bookmark ? bookmark.title : "este bookmark";
    if (!window.confirm(`Remover "${label}"? Essa ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await Api.remove(deleteBtn.dataset.id);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
  }
});

els.list.addEventListener("submit", async (e) => {
  const form = e.target.closest(".edit-form");
  if (!form) return;
  e.preventDefault();

  const formData = new FormData(form);
  const categoriesSelect = form.querySelector('select[name="categories"]');
  const selectedCategories = Array.from(categoriesSelect.selectedOptions).map((opt) => opt.value);
  const newCategories = formData
    .get("new-categories")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const categories = Array.from(new Set([...selectedCategories, ...newCategories]));

  const payload = {
    url: formData.get("url").trim(),
    title: formData.get("title").trim(),
    description: formData.get("description").trim(),
    tags: formData
      .get("tags")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    categories,
  };

  try {
    await Api.update(form.dataset.id, payload);
    state.editingId = null;
    await loadBookmarks();
  } catch (err) {
    alert(err.message);
  }
});

els.clearTagFilterBtn.addEventListener("click", () => {
  state.activeTag = null;
  render();
});

els.urlInput.addEventListener("blur", async () => {
  const url = els.urlInput.value.trim();
  if (!url || els.titleInput.value.trim() || !/^https?:\/\//i.test(url)) return;

  els.formStatus.textContent = "Buscando título...";
  const result = await Api.fetchTitle(url);
  if (result.title) {
    els.titleInput.value = result.title;
    els.formStatus.textContent = "";
  } else {
    els.formStatus.textContent = "Não foi possível obter o título automaticamente — preencha manualmente.";
  }
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(els.form);
  const selectedCategories = Array.from(els.categoriesSelect.selectedOptions).map((opt) => opt.value);
  const newCategories = formData
    .get("new-categories")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const categories = Array.from(new Set([...selectedCategories, ...newCategories]));

  const payload = {
    url: formData.get("url").trim(),
    title: formData.get("title").trim(),
    description: formData.get("description").trim(),
    tags: formData
      .get("tags")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    categories,
  };

  els.formStatus.textContent = "Salvando...";
  try {
    await Api.create(payload);
    await loadBookmarks();
    els.form.reset();
    els.formStatus.textContent = "Bookmark salvo!";
    setTimeout(() => (els.formStatus.textContent = ""), 2000);
  } catch (err) {
    els.formStatus.textContent = err.message;
  }
});

els.exportBtn.addEventListener("click", async () => {
  try {
    const data = await Api.load();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `bookmarks-export-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    els.importStatus.textContent = err.message;
  }
});

els.importBtn.addEventListener("click", () => {
  els.importFileInput.click();
});

els.importFileInput.addEventListener("change", async () => {
  const file = els.importFileInput.files[0];
  if (!file) return;

  els.importStatus.textContent = "Importando...";
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Arquivo não é um JSON válido");
    }

    const result = await Api.import(parsed);
    await loadBookmarks();
    els.importStatus.textContent =
      `${result.importedCount} importado(s) com tag "import", ${result.skippedCount} ignorado(s) (já existiam)` +
      (result.invalidCount ? `, ${result.invalidCount} inválido(s)` : "");
  } catch (err) {
    els.importStatus.textContent = err.message;
  } finally {
    els.importFileInput.value = "";
  }
});

if (Api.mode === "github") {
  els.githubConfigBtn.classList.remove("hidden");
  els.githubConfigBtn.addEventListener("click", () => {
    const token = window.prompt(
      "Cole seu Personal Access Token do GitHub (permissão de leitura/escrita de conteúdo neste repositório):"
    );
    if (token === null) return;
    Api.configure(token.trim());
    els.importStatus.textContent = token.trim() ? "Token salvo." : "Token removido.";
    loadBookmarks().catch((err) => {
      els.importStatus.textContent = err.message;
    });
  });
}

loadBookmarks().catch((err) => {
  els.resultsCount.textContent = "";
  els.emptyState.textContent = `Erro ao carregar bookmarks: ${err.message}`;
  els.emptyState.classList.remove("hidden");
});
