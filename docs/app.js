const ACTION_ICONS = {
  Ler: "📖",
  Ouvir: "🎧",
  Assistir: "🎬",
  Comprar: "🛒",
  Baixar: "⬇️",
  Jogar: "🎮",
};

const THEME_STORAGE_KEY = "meusBookmarks.theme";

const CATEGORY_PALETTE = [
  "#e87ba4", // magenta
  "#0891b2", // ciano
  "#eda100", // amarelo
  "#1baf7a", // verde água
  "#4a3aa7", // violeta
  "#74b9ff", // azul claro
  "#008300", // verde
  "#2a78d6", // azul
  "#eb6834", // laranja
];

// Ordem de atribuição de cor (fixa, independente da ordem de exibição das coleções).
// Coleções novas entram no fim automaticamente, na ordem em que aparecem nos dados.
const GROUP_COLOR_ORDER = ["conteudo", "recurso", "midia", "editorial", "inspiracao", "quotes"];

function groupColor(groupId) {
  let index = GROUP_COLOR_ORDER.indexOf(groupId);
  if (index === -1) {
    const unknownIds = state.categoryGroups.map((g) => g.id).filter((id) => !GROUP_COLOR_ORDER.includes(id));
    index = GROUP_COLOR_ORDER.length + unknownIds.indexOf(groupId);
  }
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

function effectiveTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  themeToggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  themeToggleBtn.title = theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro";
}

applyTheme(effectiveTheme());

const BOOKMARKS_PAGE_SIZE = 50;

const state = {
  bookmarks: [],
  categoryGroups: [],
  actions: [],
  searchTerms: [],
  searchTermsRaw: [],
  activeTag: null,
  activeCategory: "",
  activeAction: "",
  editingId: null,
  visibleCount: BOOKMARKS_PAGE_SIZE,
};

const els = {
  searchInput: document.getElementById("search-input"),
  categoryMenu: document.getElementById("category-menu"),
  actionMenu: document.getElementById("action-menu"),
  activeFilters: document.getElementById("active-filters"),
  list: document.getElementById("bookmark-list"),
  resultsCount: document.getElementById("results-count"),
  emptyState: document.getElementById("empty-state"),
  form: document.getElementById("add-form"),
  urlInput: document.getElementById("url"),
  titleInput: document.getElementById("title"),
  actionSelect: document.getElementById("action-select"),
  categoriesGroupsContainer: document.getElementById("categories-groups"),
  newCategoryGroupSelect: document.getElementById("new-category-group"),
  formStatus: document.getElementById("form-status"),
  exportBtn: document.getElementById("export-btn"),
  importBtn: document.getElementById("import-btn"),
  importFileInput: document.getElementById("import-file-input"),
  importStatus: document.getElementById("import-status"),
  githubConfigBtn: document.getElementById("github-config-btn"),
  categoryManagerBtn: document.getElementById("category-manager-btn"),
  categoryManagerOverlay: document.getElementById("category-manager-overlay"),
  categoryManagerBody: document.getElementById("category-manager-body"),
  categoryManagerCloseBtn: document.getElementById("category-manager-close-btn"),
  actionManagerBtn: document.getElementById("action-manager-btn"),
  actionManagerOverlay: document.getElementById("action-manager-overlay"),
  actionManagerBody: document.getElementById("action-manager-body"),
  actionManagerCloseBtn: document.getElementById("action-manager-close-btn"),
  loadMoreBtn: document.getElementById("load-more-btn"),
  favoritesSection: document.getElementById("favorites-section"),
  favoritesList: document.getElementById("favorites-list"),
  tagCloudSection: document.getElementById("tag-cloud-section"),
  tagCloud: document.getElementById("tag-cloud"),
  tagManagerBtn: document.getElementById("tag-manager-btn"),
  tagManagerOverlay: document.getElementById("tag-manager-overlay"),
  tagManagerSearch: document.getElementById("tag-manager-search"),
  tagManagerList: document.getElementById("tag-manager-list"),
  tagManagerCloseBtn: document.getElementById("tag-manager-close-btn"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
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

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatches(text) {
  const safe = escapeHtml(text || "");
  const escapedTerms = state.searchTermsRaw.map((t) => escapeRegExp(escapeHtml(t))).filter(Boolean);
  if (!escapedTerms.length) return safe;
  const regex = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  return safe.replace(regex, "<mark>$1</mark>");
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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

function groupForCategory(name) {
  const group = state.categoryGroups.find((g) => (g.categories || []).includes(name));
  return group ? group.id : "";
}

function matchesFilters(bookmark) {
  if (state.activeTag && !bookmark.tags.includes(state.activeTag)) {
    return false;
  }
  if (state.activeCategory && !bookmark.categories.includes(state.activeCategory)) {
    return false;
  }
  if (state.activeAction && bookmark.action !== state.activeAction) {
    return false;
  }
  if (state.searchTerms.length && !state.searchTerms.every((term) => bookmark._searchHaystack.includes(term))) {
    return false;
  }
  return true;
}

function sortedAlpha(items) {
  return [...items].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function tagCounts() {
  const counts = new Map();
  for (const bookmark of state.bookmarks) {
    for (const tag of bookmark.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "pt-BR"));
}

const DIACRITICS_RE = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);

function normalizeForMatch(str) {
  return str.normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase();
}

function resetVisibleCount() {
  state.visibleCount = BOOKMARKS_PAGE_SIZE;
}

function toggleTagFilter(tag) {
  state.activeTag = state.activeTag === tag ? null : tag;
  resetVisibleCount();
  render();
}

function toggleCategoryFilter(category) {
  state.activeCategory = state.activeCategory === category ? "" : category;
  resetVisibleCount();
  render();
}

function toggleActionFilter(action) {
  state.activeAction = state.activeAction === action ? "" : action;
  resetVisibleCount();
  render();
}

function tagFragment(value) {
  const lastComma = value.lastIndexOf(",");
  return value.slice(lastComma + 1).trim();
}

function matchingTagSuggestions(fragment, limit = 8) {
  const norm = normalizeForMatch(fragment);
  if (!norm) return [];
  return tagCounts()
    .filter(({ tag }) => normalizeForMatch(tag).includes(norm))
    .slice(0, limit)
    .map(({ tag }) => tag);
}

function applyTagSuggestion(input, tag) {
  const lastComma = input.value.lastIndexOf(",");
  const prefix = lastComma === -1 ? "" : input.value.slice(0, lastComma + 1) + " ";
  input.value = `${prefix}${tag}, `;
  input.focus();
}

function tagSuggestionsMarkup(tags) {
  return tags
    .map((tag) => `<button type="button" class="tag-suggestion-item" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
    .join("");
}

function hideAllTagSuggestions() {
  document.querySelectorAll(".tag-suggestions").forEach((box) => box.classList.add("hidden"));
}

function handleTagInput(e) {
  const input = e.target.closest('input[name="tags"]');
  if (!input) return;
  const box = input.closest(".tag-input-wrapper").querySelector(".tag-suggestions");
  const suggestions = matchingTagSuggestions(tagFragment(input.value));
  if (!suggestions.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.innerHTML = tagSuggestionsMarkup(suggestions);
  box.classList.remove("hidden");
}

function handleTagSuggestionClick(e) {
  const item = e.target.closest(".tag-suggestion-item");
  if (!item) return false;
  const wrapper = item.closest(".tag-input-wrapper");
  applyTagSuggestion(wrapper.querySelector('input[name="tags"]'), item.dataset.tag);
  wrapper.querySelector(".tag-suggestions").classList.add("hidden");
  return true;
}

function categoryMenuMarkup() {
  return state.categoryGroups
    .map(
      (group) => `
        <div class="category-menu-group" data-group="${escapeHtml(group.id)}" style="--cat-hue:${groupColor(group.id)}">
          <span class="category-menu-label">${escapeHtml(group.label)}</span>
          ${sortedAlpha(group.categories)
            .map(
              (cat) =>
                `<button type="button" class="category-pill${cat === state.activeCategory ? " active" : ""}" data-category="${escapeHtml(cat)}" data-group="${escapeHtml(group.id)}">${escapeHtml(cat)}</button>`
            )
            .join("")}
        </div>`
    )
    .join("");
}

function categoryGroupsFormMarkup(selectedCategories) {
  const selected = new Set(selectedCategories);
  return state.categoryGroups
    .map(
      (group) => `
        <fieldset class="category-group" data-group="${escapeHtml(group.id)}" style="--cat-hue:${groupColor(group.id)}">
          <legend>${escapeHtml(group.label)}</legend>
          ${sortedAlpha(group.categories)
            .map(
              (cat) => `
                <label class="category-checkbox">
                  <input type="checkbox" name="categories" value="${escapeHtml(cat)}"${selected.has(cat) ? " checked" : ""} />
                  ${escapeHtml(cat)}
                </label>`
            )
            .join("")}
        </fieldset>`
    )
    .join("");
}

function actionMenuMarkup() {
  return sortedAlpha(state.actions)
    .map(
      (action) =>
        `<button type="button" class="action-pill${action === state.activeAction ? " active" : ""}" data-action="${escapeHtml(action)}">${ACTION_ICONS[action] ? ACTION_ICONS[action] + " " : ""}${escapeHtml(action)}</button>`
    )
    .join("");
}

function activeFiltersMarkup() {
  const chips = [];
  if (state.activeCategory) {
    chips.push({ type: "category", label: `Categoria: ${state.activeCategory}` });
  }
  if (state.activeAction) {
    chips.push({ type: "action", label: `Ação: ${state.activeAction}` });
  }
  if (state.activeTag) {
    chips.push({ type: "tag", label: `Tag: ${state.activeTag}` });
  }
  if (!chips.length) return "";

  const chipsHtml = chips
    .map(
      (chip) => `
        <span class="active-filter-chip">
          ${escapeHtml(chip.label)}
          <button type="button" class="remove-filter-btn" data-filter-type="${chip.type}" title="Remover filtro">✕</button>
        </span>`
    )
    .join("");

  const clearAllHtml =
    chips.length > 1
      ? `<button type="button" class="clear-all-filters-btn">Limpar tudo</button>`
      : "";

  return `<span class="active-filters-label">Filtros ativos:</span>${chipsHtml}${clearAllHtml}`;
}

const TAG_CLOUD_LIMIT = 20;

function tagCloudMarkup() {
  return tagCounts()
    .slice(0, TAG_CLOUD_LIMIT)
    .map(
      ({ tag }) =>
        `<button type="button" class="tag-cloud-item${tag === state.activeTag ? " active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
    )
    .join("");
}

function categoryGroupOptionsMarkup() {
  return state.categoryGroups
    .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.label)}</option>`)
    .join("");
}

function actionOptionsMarkup(selected) {
  return (
    `<option value="">Selecione...</option>` +
    state.actions
      .map(
        (a) => `<option value="${escapeHtml(a)}"${a === selected ? " selected" : ""}>${ACTION_ICONS[a] ? ACTION_ICONS[a] + " " : ""}${escapeHtml(a)}</option>`
      )
      .join("")
  );
}

function renderFilterAndFormOptions() {
  els.categoryMenu.innerHTML = categoryMenuMarkup();
  els.actionMenu.innerHTML = actionMenuMarkup();

  els.actionSelect.innerHTML = actionOptionsMarkup("");
  els.newCategoryGroupSelect.innerHTML = categoryGroupOptionsMarkup();
  els.categoriesGroupsContainer.innerHTML = categoryGroupsFormMarkup([]);
}

function render() {
  const hasSearch = state.searchTerms.length > 0;
  const filtered = state.bookmarks
    .filter(matchesFilters)
    .sort((a, b) => {
      if (hasSearch) {
        const scoreDiff = searchScore(b) - searchScore(a);
        if (scoreDiff !== 0) return scoreDiff;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  els.categoryMenu.innerHTML = categoryMenuMarkup();
  els.actionMenu.innerHTML = actionMenuMarkup();

  const hasActiveFilters = Boolean(state.activeCategory || state.activeAction || state.activeTag);
  els.activeFilters.classList.toggle("hidden", !hasActiveFilters);
  els.activeFilters.innerHTML = activeFiltersMarkup();

  const visible = filtered.slice(0, state.visibleCount);

  els.resultsCount.textContent =
    visible.length < filtered.length
      ? `${visible.length} de ${filtered.length} bookmarks`
      : `${filtered.length} bookmark${filtered.length === 1 ? "" : "s"}`;
  els.emptyState.classList.toggle("hidden", filtered.length > 0);

  els.list.innerHTML = visible
    .map((bookmark) =>
      bookmark.id === state.editingId ? editFormMarkup(bookmark) : bookmarkItemMarkup(bookmark)
    )
    .join("");

  const remaining = filtered.length - visible.length;
  els.loadMoreBtn.classList.toggle("hidden", remaining <= 0);
  if (remaining > 0) {
    els.loadMoreBtn.textContent = `Carregar mais (${remaining} restante${remaining === 1 ? "" : "s"})`;
  }

  const favorites = state.bookmarks.filter((b) => b.favorite);
  els.favoritesSection.classList.toggle("hidden", favorites.length === 0);
  if (!document.activeElement || !document.activeElement.classList.contains("favorite-item-note")) {
    els.favoritesList.innerHTML = favoritesListMarkup(favorites);
  }

  const tags = tagCounts();
  els.tagCloudSection.classList.toggle("hidden", tags.length === 0);
  els.tagCloud.innerHTML = tagCloudMarkup();
}

function bookmarkItemMarkup(bookmark) {
  const tagsHtml = bookmark.tags
    .map(
      (tag) => `<button type="button" class="tag-pill${tag === state.activeTag ? " active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
    )
    .join("");

  const categoriesHtml = bookmark.categories
    .map((cat) => {
      const groupId = groupForCategory(cat);
      return `<button type="button" class="category-pill${cat === state.activeCategory ? " active" : ""}" data-category="${escapeHtml(cat)}" data-group="${escapeHtml(groupId)}" style="--cat-hue:${groupColor(groupId)}">${escapeHtml(cat)}</button>`;
    })
    .join("");

  const actionHtml = bookmark.action
    ? `<button type="button" class="action-pill${bookmark.action === state.activeAction ? " active" : ""}" data-action="${escapeHtml(bookmark.action)}">${ACTION_ICONS[bookmark.action] ? ACTION_ICONS[bookmark.action] + " " : ""}${escapeHtml(bookmark.action)}</button>`
    : "";

  const favoriteHtml = `<button type="button" class="favorite-star-btn${bookmark.favorite ? " active" : ""}" data-id="${escapeHtml(bookmark.id)}" title="${bookmark.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}">${bookmark.favorite ? "★" : "☆"}</button>`;

  const isQuote = bookmark.categories.includes("Quote");
  const quoteStyle = isQuote ? ` style="--cat-hue:${groupColor("quotes")}"` : "";

  return `
    <li class="bookmark-item${isQuote ? " quote-bookmark" : ""}" data-id="${escapeHtml(bookmark.id)}"${quoteStyle}>
      <h3><a href="${escapeHtml(bookmark.url)}" target="_blank" rel="noopener noreferrer">${highlightMatches(bookmark.title)}</a></h3>
      <div class="bookmark-url">${escapeHtml(bookmark.url)}</div>
      ${bookmark.description ? `<p class="bookmark-description">${highlightMatches(bookmark.description)}</p>` : ""}
      <div class="bookmark-meta">
        ${favoriteHtml}
        <span class="bookmark-date">${formatDate(bookmark.createdAt)}</span>
        ${actionHtml}
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
          <label>Notas</label>
          <textarea name="description" rows="2">${escapeHtml(bookmark.description)}</textarea>
        </div>
        <div class="form-row">
          <label>Tags</label>
          <div class="tag-input-wrapper">
            <input name="tags" type="text" value="${escapeHtml(bookmark.tags.join(", "))}" autocomplete="off" />
            <div class="tag-suggestions hidden"></div>
          </div>
        </div>
        <div class="form-row">
          <label>Ação</label>
          <select name="action">${actionOptionsMarkup(bookmark.action)}</select>
        </div>
        <div class="form-row">
          <label>Nova ação (opcional)</label>
          <input name="new-action" type="text" placeholder="ex: ✍️ Estudar" />
        </div>
        <div class="form-row">
          <label>Categorias gerais</label>
          <div class="categories-groups">${categoryGroupsFormMarkup(bookmark.categories)}</div>
        </div>
        <div class="form-row new-category-row">
          <label>Nova(s) categoria(s)</label>
          <input name="new-categories" type="text" placeholder="separadas por vírgula" />
          <select name="new-category-group">${categoryGroupOptionsMarkup()}</select>
        </div>
        <div class="form-actions">
          <button type="submit">Salvar</button>
          <button type="button" class="cancel-edit-btn">Cancelar</button>
        </div>
      </form>
    </li>
  `;
}

function favoriteItemMarkup(bookmark) {
  return `
    <li class="favorite-item" data-id="${escapeHtml(bookmark.id)}">
      <button type="button" class="favorite-star-btn active" data-id="${escapeHtml(bookmark.id)}" title="Remover dos favoritos">★</button>
      <div class="favorite-item-info">
        <a href="${escapeHtml(bookmark.url)}" target="_blank" rel="noopener noreferrer" class="favorite-item-title">${escapeHtml(bookmark.title)}</a>
        <span class="favorite-item-domain">${escapeHtml(getDomain(bookmark.url))}</span>
        <input type="text" class="favorite-item-note" data-id="${escapeHtml(bookmark.id)}" value="${escapeHtml(bookmark.favoriteNote || "")}" placeholder="por que está aqui?" />
      </div>
    </li>
  `;
}

function favoritesListMarkup(favorites) {
  return favorites.map(favoriteItemMarkup).join("");
}

function categoryManagerMarkup() {
  return state.categoryGroups
    .map(
      (group) => `
        <div class="manager-group" data-group="${escapeHtml(group.id)}" style="--cat-hue:${groupColor(group.id)}">
          <h3>${escapeHtml(group.label)}</h3>
          <ul class="manager-category-list">
            ${group.categories
              .map(
                (cat) => `
                  <li data-category="${escapeHtml(cat)}">
                    <input type="text" class="rename-input" value="${escapeHtml(cat)}" />
                    <button type="button" class="rename-category-btn" data-group="${escapeHtml(group.id)}" data-category="${escapeHtml(cat)}">Renomear</button>
                    <button type="button" class="delete-category-btn" data-group="${escapeHtml(group.id)}" data-category="${escapeHtml(cat)}">Excluir</button>
                  </li>`
              )
              .join("")}
          </ul>
          <div class="manager-add-row">
            <input type="text" class="new-category-input" placeholder="Nova categoria" />
            <button type="button" class="add-category-btn" data-group="${escapeHtml(group.id)}">Adicionar</button>
          </div>
        </div>`
    )
    .join("");
}

function splitActionIcon(action) {
  if (ACTION_ICONS[action]) {
    return { icon: ACTION_ICONS[action], label: action, embedded: false };
  }
  const match = action.match(/^(\S+)\s+(.*)$/);
  if (match && /\p{Extended_Pictographic}/u.test(match[1])) {
    return { icon: match[1], label: match[2], embedded: true };
  }
  return { icon: "", label: action, embedded: false };
}

function actionManagerMarkup() {
  return `
    <ul class="manager-category-list">
      ${sortedAlpha(state.actions)
        .map((action) => {
          const { icon, label, embedded } = splitActionIcon(action);
          return `
            <li data-action="${escapeHtml(action)}" data-icon="${escapeHtml(icon)}" data-icon-embedded="${embedded}">
              <span class="action-manager-icon">${escapeHtml(icon)}</span>
              <input type="text" class="rename-input" value="${escapeHtml(label)}" />
              <button type="button" class="rename-action-btn" data-action="${escapeHtml(action)}">Renomear</button>
              <button type="button" class="delete-action-btn" data-action="${escapeHtml(action)}">Excluir</button>
            </li>`;
        })
        .join("")}
    </ul>
    <div class="manager-add-row">
      <input type="text" class="new-action-input" placeholder="Nova ação" />
      <button type="button" class="add-action-btn">Adicionar</button>
    </div>
  `;
}

function tagManagerMarkup(filterText) {
  const filter = normalizeForMatch(filterText || "");
  const rows = tagCounts().filter(({ tag }) => !filter || normalizeForMatch(tag).includes(filter));
  if (!rows.length) {
    return `<li class="tag-manager-empty">Nenhuma tag encontrada.</li>`;
  }
  return rows
    .map(
      ({ tag, count }) => `
        <li data-tag="${escapeHtml(tag)}">
          <input type="text" class="rename-input" value="${escapeHtml(tag)}" />
          <span class="tag-manager-count">${count} bookmark${count === 1 ? "" : "s"}</span>
          <button type="button" class="rename-tag-btn" data-tag="${escapeHtml(tag)}">Renomear</button>
          <button type="button" class="delete-tag-btn" data-tag="${escapeHtml(tag)}">Excluir</button>
        </li>`
    )
    .join("");
}

function refreshTagManagerList() {
  els.tagManagerList.innerHTML = tagManagerMarkup(els.tagManagerSearch.value);
}

async function toggleFavorite(id) {
  const bookmark = state.bookmarks.find((b) => b.id === id);
  if (!bookmark) return;
  try {
    await Api.update(id, { ...bookmark, favorite: !bookmark.favorite });
    await loadBookmarks();
  } catch (err) {
    alert(err.message);
  }
}

const SEARCH_FIELD_WEIGHTS = {
  title: 5,
  tags: 4,
  categories: 3,
  action: 2,
  description: 1,
};

function buildSearchFields(bookmark) {
  return {
    title: normalizeForMatch(bookmark.title || ""),
    description: normalizeForMatch(bookmark.description || ""),
    action: normalizeForMatch(bookmark.action || ""),
    tags: normalizeForMatch((bookmark.tags || []).join(" ")),
    categories: normalizeForMatch((bookmark.categories || []).join(" ")),
  };
}

function searchScore(bookmark) {
  let score = 0;
  for (const term of state.searchTerms) {
    for (const field in SEARCH_FIELD_WEIGHTS) {
      if (bookmark._searchFields[field].includes(term)) {
        score += SEARCH_FIELD_WEIGHTS[field];
      }
    }
  }
  return score;
}

async function loadBookmarks() {
  const data = await Api.load();
  state.bookmarks = (data.bookmarks || []).map((b) => {
    const bookmark = { categories: [], action: "", favorite: false, favoriteNote: "", ...b };
    bookmark._searchFields = buildSearchFields(bookmark);
    bookmark._searchHaystack = Object.values(bookmark._searchFields).join(" ");
    return bookmark;
  });
  state.categoryGroups = data.categoryGroups || [];
  state.actions = data.actions || [];
  renderFilterAndFormOptions();
  render();
  if (!els.categoryManagerOverlay.classList.contains("hidden")) {
    els.categoryManagerBody.innerHTML = categoryManagerMarkup();
  }
  if (!els.actionManagerOverlay.classList.contains("hidden")) {
    els.actionManagerBody.innerHTML = actionManagerMarkup();
  }
  if (!els.tagManagerOverlay.classList.contains("hidden")) {
    refreshTagManagerList();
  }
}

els.searchInput.addEventListener("input", (e) => {
  const raw = e.target.value.trim();
  state.searchTerms = normalizeForMatch(raw).split(/\s+/).filter(Boolean);
  state.searchTermsRaw = raw.split(/\s+/).filter(Boolean);
  resetVisibleCount();
  render();
});

els.categoryMenu.addEventListener("click", (e) => {
  const categoryBtn = e.target.closest(".category-pill");
  if (!categoryBtn) return;
  toggleCategoryFilter(categoryBtn.dataset.category);
});

els.actionMenu.addEventListener("click", (e) => {
  const actionBtn = e.target.closest(".action-pill");
  if (!actionBtn) return;
  toggleActionFilter(actionBtn.dataset.action);
});

els.loadMoreBtn.addEventListener("click", () => {
  state.visibleCount += BOOKMARKS_PAGE_SIZE;
  render();
});

els.favoritesList.addEventListener("click", (e) => {
  const favoriteBtn = e.target.closest(".favorite-star-btn");
  if (favoriteBtn) {
    toggleFavorite(favoriteBtn.dataset.id);
  }
});

const favoriteNoteSaveTimers = new Map();

async function saveFavoriteNote(id, text) {
  const bookmark = state.bookmarks.find((b) => b.id === id);
  if (!bookmark) return;
  try {
    await Api.update(id, { ...bookmark, favoriteNote: text });
    bookmark.favoriteNote = text;
  } catch (err) {
    alert(err.message);
  }
}

els.favoritesList.addEventListener("input", (e) => {
  const input = e.target.closest(".favorite-item-note");
  if (!input) return;
  const id = input.dataset.id;
  clearTimeout(favoriteNoteSaveTimers.get(id));
  favoriteNoteSaveTimers.set(
    id,
    setTimeout(() => saveFavoriteNote(id, input.value), 800)
  );
});

els.tagCloud.addEventListener("click", (e) => {
  const tagBtn = e.target.closest(".tag-cloud-item");
  if (!tagBtn) return;
  toggleTagFilter(tagBtn.dataset.tag);
});

els.list.addEventListener("click", async (e) => {
  const favoriteBtn = e.target.closest(".favorite-star-btn");
  if (favoriteBtn) {
    toggleFavorite(favoriteBtn.dataset.id);
    return;
  }
  const tagBtn = e.target.closest(".tag-pill");
  if (tagBtn) {
    toggleTagFilter(tagBtn.dataset.tag);
    return;
  }
  const categoryBtn = e.target.closest(".category-pill");
  if (categoryBtn) {
    toggleCategoryFilter(categoryBtn.dataset.category);
    return;
  }
  const actionBtn = e.target.closest(".action-pill");
  if (actionBtn) {
    toggleActionFilter(actionBtn.dataset.action);
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
  const selectedCategories = formData.getAll("categories");
  const newCategories = formData
    .get("new-categories")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const newCategoryGroup = formData.get("new-category-group");
  const categories = Array.from(new Set([...selectedCategories, ...newCategories]));
  const action = formData.get("new-action").trim() || formData.get("action");

  const payload = {
    url: formData.get("url").trim(),
    title: formData.get("title").trim(),
    description: formData.get("description").trim(),
    tags: formData
      .get("tags")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    action,
    categories,
    newCategories,
    newCategoryGroup,
  };

  try {
    await Api.update(form.dataset.id, payload);
    state.editingId = null;
    await loadBookmarks();
  } catch (err) {
    alert(err.message);
  }
});

els.activeFilters.addEventListener("click", (e) => {
  if (e.target.closest(".clear-all-filters-btn")) {
    state.activeCategory = "";
    state.activeAction = "";
    state.activeTag = null;
    resetVisibleCount();
    render();
    return;
  }
  const removeBtn = e.target.closest(".remove-filter-btn");
  if (!removeBtn) return;
  const type = removeBtn.dataset.filterType;
  if (type === "category") state.activeCategory = "";
  if (type === "action") state.activeAction = "";
  if (type === "tag") state.activeTag = null;
  resetVisibleCount();
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
  const selectedCategories = formData.getAll("categories");
  const newCategories = formData
    .get("new-categories")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const newCategoryGroup = formData.get("new-category-group");
  const categories = Array.from(new Set([...selectedCategories, ...newCategories]));
  const action = formData.get("new-action").trim() || formData.get("action");

  const payload = {
    url: formData.get("url").trim(),
    title: formData.get("title").trim(),
    description: formData.get("description").trim(),
    tags: formData
      .get("tags")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    action,
    categories,
    newCategories,
    newCategoryGroup,
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

document.addEventListener("input", handleTagInput);

document.addEventListener("click", (e) => {
  if (handleTagSuggestionClick(e)) return;
  if (!e.target.closest(".tag-input-wrapper")) {
    hideAllTagSuggestions();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideAllTagSuggestions();
});

els.themeToggleBtn.addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

els.categoryManagerBtn.addEventListener("click", () => {
  els.categoryManagerBody.innerHTML = categoryManagerMarkup();
  els.categoryManagerOverlay.classList.remove("hidden");
});

els.categoryManagerCloseBtn.addEventListener("click", () => {
  els.categoryManagerOverlay.classList.add("hidden");
});

els.categoryManagerOverlay.addEventListener("click", (e) => {
  if (e.target === els.categoryManagerOverlay) {
    els.categoryManagerOverlay.classList.add("hidden");
  }
});

els.categoryManagerBody.addEventListener("click", async (e) => {
  const addBtn = e.target.closest(".add-category-btn");
  if (addBtn) {
    const input = addBtn.parentElement.querySelector(".new-category-input");
    const name = input.value.trim();
    if (!name) return;
    try {
      await Api.addCategory(addBtn.dataset.group, name);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const renameBtn = e.target.closest(".rename-category-btn");
  if (renameBtn) {
    const row = renameBtn.closest("li");
    const newName = row.querySelector(".rename-input").value.trim();
    if (!newName) return;
    try {
      await Api.renameCategory(renameBtn.dataset.group, renameBtn.dataset.category, newName);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const deleteBtn = e.target.closest(".delete-category-btn");
  if (deleteBtn) {
    if (!window.confirm(`Excluir a categoria "${deleteBtn.dataset.category}"? Ela será removida de todos os bookmarks que a usam.`)) {
      return;
    }
    try {
      await Api.deleteCategory(deleteBtn.dataset.group, deleteBtn.dataset.category);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
  }
});

els.actionManagerBtn.addEventListener("click", () => {
  els.actionManagerBody.innerHTML = actionManagerMarkup();
  els.actionManagerOverlay.classList.remove("hidden");
});

els.actionManagerCloseBtn.addEventListener("click", () => {
  els.actionManagerOverlay.classList.add("hidden");
});

els.actionManagerOverlay.addEventListener("click", (e) => {
  if (e.target === els.actionManagerOverlay) {
    els.actionManagerOverlay.classList.add("hidden");
  }
});

els.actionManagerBody.addEventListener("click", async (e) => {
  const addBtn = e.target.closest(".add-action-btn");
  if (addBtn) {
    const input = addBtn.parentElement.querySelector(".new-action-input");
    const name = input.value.trim();
    if (!name) return;
    try {
      await Api.addAction(name);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const renameBtn = e.target.closest(".rename-action-btn");
  if (renameBtn) {
    const row = renameBtn.closest("li");
    let newName = row.querySelector(".rename-input").value.trim();
    if (!newName) return;
    if (row.dataset.iconEmbedded === "true" && row.dataset.icon) {
      newName = `${row.dataset.icon} ${newName}`;
    }
    try {
      await Api.renameAction(renameBtn.dataset.action, newName);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const deleteBtn = e.target.closest(".delete-action-btn");
  if (deleteBtn) {
    if (!window.confirm(`Excluir a ação "${deleteBtn.dataset.action}"? Ela será removida de todos os bookmarks que a usam.`)) {
      return;
    }
    try {
      await Api.deleteAction(deleteBtn.dataset.action);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
  }
});

els.tagManagerBtn.addEventListener("click", () => {
  els.tagManagerSearch.value = "";
  refreshTagManagerList();
  els.tagManagerOverlay.classList.remove("hidden");
});

els.tagManagerCloseBtn.addEventListener("click", () => {
  els.tagManagerOverlay.classList.add("hidden");
});

els.tagManagerOverlay.addEventListener("click", (e) => {
  if (e.target === els.tagManagerOverlay) {
    els.tagManagerOverlay.classList.add("hidden");
  }
});

els.tagManagerSearch.addEventListener("input", refreshTagManagerList);

els.tagManagerList.addEventListener("click", async (e) => {
  const renameBtn = e.target.closest(".rename-tag-btn");
  if (renameBtn) {
    const row = renameBtn.closest("li");
    const newName = row.querySelector(".rename-input").value.trim();
    if (!newName || newName === renameBtn.dataset.tag) return;
    try {
      await Api.renameTag(renameBtn.dataset.tag, newName);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const deleteTagBtn = e.target.closest(".delete-tag-btn");
  if (deleteTagBtn) {
    if (!window.confirm(`Excluir a tag "${deleteTagBtn.dataset.tag}"? Ela será removida de todos os bookmarks que a usam.`)) {
      return;
    }
    try {
      await Api.deleteTag(deleteTagBtn.dataset.tag);
      await loadBookmarks();
    } catch (err) {
      alert(err.message);
    }
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
