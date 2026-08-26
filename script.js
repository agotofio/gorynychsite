"use strict";

/**
 * Art-Pub Gorynych — digital menu
 * Loads structured menu data from data/menu.json, renders categories/items,
 * and wires up search, filters, category navigation and the quick-view modal.
 */

const MENU_DATA_URL = "data/menu.json";

const els = {
  menuGrid: document.getElementById("menuGrid"),
  sectionNav: document.getElementById("sectionNav"),
  stats: document.getElementById("menuStats"),
  search: document.getElementById("menuSearch"),
  searchClear: document.getElementById("searchClear"),
  searchStatus: document.getElementById("searchStatus"),
  quickTabs: [...document.querySelectorAll(".quick-tabs button")],
  modal: document.getElementById("itemModal"),
  modalDialog: document.getElementById("itemModalDialog"),
};

let menu = null;
let activeFilter = "all";
let searchTerm = "";
let debounceHandle = null;
let revealObserver = null;
let navObserver = null;
let lastFocusedBeforeModal = null;

/* ---------------------------------------------------------------------- */
/* Text normalisation & search                                            */
/* ---------------------------------------------------------------------- */

/** Normalises Cyrillic/Latin text for forgiving search matching. */
function normalize(value = "") {
  return value
    .toString()
    .toLocaleLowerCase("uk-UA")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[«»"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function debounce(fn, delay) {
  return (...args) => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => fn(...args), delay);
  };
}

function itemMatchesSearch(category, item, term) {
  if (!term) return true;
  const haystack = normalize(
    [category.name, item.name, item.description, item.weight, String(item.price ?? "")]
      .filter(Boolean)
      .join(" ")
  );
  return haystack.includes(term);
}

function itemMatchesFilter(category, item) {
  if (activeFilter === "food" && category.type !== "food") return false;
  if (activeFilter === "drinks" && category.type !== "drinks") return false;
  if (activeFilter === "photo" && !item.image) return false;
  return true;
}

function getVisibleCategories() {
  const term = normalize(searchTerm);
  return menu.categories
    .map((category) => ({
      ...category,
      items: category.items.filter(
        (item) => itemMatchesFilter(category, item) && itemMatchesSearch(category, item, term)
      ),
    }))
    .filter((category) => category.items.length > 0);
}

/* ---------------------------------------------------------------------- */
/* Rendering                                                              */
/* ---------------------------------------------------------------------- */

function escapeHtml(value = "") {
  return value
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function priceLabel(price) {
  return escapeHtml(String(price ?? "—"));
}

function renderNav(categories) {
  const activeId = categories[0]?.id;
  els.sectionNav.innerHTML = categories
    .map(
      (category) => `
        <button type="button" class="${category.id === activeId ? "active" : ""}"
          data-target="${category.id}" aria-current="${category.id === activeId ? "true" : "false"}">
          ${escapeHtml(category.name)}
        </button>
      `
    )
    .join("");

  els.sectionNav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.target);
      setActiveNavButton(button.dataset.target);
      target?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      history.replaceState(null, "", `#${button.dataset.target}`);
    });
  });
}

function setActiveNavButton(targetId) {
  els.sectionNav.querySelectorAll("button").forEach((el) => {
    const isActive = el.dataset.target === targetId;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-current", isActive ? "true" : "false");
  });
  els.sectionNav.querySelector(`button[data-target="${targetId}"]`)?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });
}

function renderItem(category, item) {
  const hasImage = Boolean(item.image);
  const photo = hasImage
    ? `<picture class="item-photo-wrap">
        <source srcset="assets/dishes/${item.image}.webp" type="image/webp">
        <img class="item-photo" src="assets/dishes/${item.image}.jpg" alt="${escapeHtml(item.name)}"
          loading="lazy" decoding="async"
          onerror="this.closest('.item-photo-wrap')?.classList.add('img-broken')"
          width="${item.imgW || 400}" height="${item.imgH || 400}">
      </picture>`
    : "";

  return `
    <article class="menu-item ${hasImage ? "" : "no-photo"}" data-item-id="${item.id}" tabindex="0" role="button"
      aria-label="Детальніше: ${escapeHtml(item.name)}">
      ${photo}
      <div class="item-body">
        <div class="item-top">
          <h3 class="item-name">${escapeHtml(item.name)}</h3>
          <span class="item-price">${priceLabel(item.price)}</span>
        </div>
        ${item.description ? `<p class="item-desc">${escapeHtml(item.description)}</p>` : ""}
        ${item.weight ? `<div class="item-meta"><span>${escapeHtml(item.weight)}</span></div>` : ""}
      </div>
    </article>
  `;
}

function renderStats(categories) {
  const itemCount = categories.reduce((sum, c) => sum + c.items.length, 0);
  const photoCount = categories.reduce(
    (sum, c) => sum + c.items.filter((item) => item.image).length,
    0
  );
  els.stats.innerHTML = `
    <span>${itemCount} позицій</span>
    <span>${photoCount} з фото</span>
    <span>${categories.length} розділів</span>
  `;
}

function renderSearchStatus(term, resultCount) {
  if (!term) {
    els.searchStatus.textContent = "";
    els.searchClear.hidden = true;
    return;
  }
  els.searchClear.hidden = false;
  els.searchStatus.textContent =
    resultCount > 0
      ? `Знайдено: ${resultCount} ${pluralizeResults(resultCount)}`
      : "Нічого не знайдено";
}

function pluralizeResults(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиція";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "позиції";
  return "позицій";
}

function updateFilterAvailability() {
  const term = normalize(searchTerm);
  els.quickTabs.forEach((button) => {
    const filter = button.dataset.filter;
    if (filter === "all") {
      button.disabled = false;
      return;
    }
    const hasMatch = menu.categories.some((category) =>
      category.items.some(
        (item) =>
          (filter === "food"
            ? category.type === "food"
            : filter === "drinks"
            ? category.type === "drinks"
            : Boolean(item.image)) && itemMatchesSearch(category, item, term)
      )
    );
    button.disabled = !hasMatch;
    button.setAttribute("aria-disabled", String(!hasMatch));
  });
}

function renderSections() {
  const categories = getVisibleCategories();
  const itemCount = categories.reduce((sum, c) => sum + c.items.length, 0);

  renderStats(categories);
  renderSearchStatus(searchTerm, itemCount);
  updateFilterAvailability();

  if (!categories.length) {
    els.sectionNav.innerHTML = "";
    els.menuGrid.innerHTML = `
      <div class="empty">
        <p class="empty-title">Нічого не знайдено</p>
        <p class="empty-hint">Спробуйте інший запит або очистіть пошук.</p>
        <button type="button" class="empty-reset" id="emptyResetBtn">Очистити пошук</button>
      </div>`;
    document.getElementById("emptyResetBtn")?.addEventListener("click", clearSearch);
    revealObserver?.disconnect();
    navObserver?.disconnect();
    return;
  }

  renderNav(categories);
  els.menuGrid.innerHTML = categories
    .map(
      (category) => `
        <section class="menu-section" id="${category.id}" aria-labelledby="${category.id}-heading">
          <div class="section-head">
            <h2 id="${category.id}-heading">${escapeHtml(category.name)}</h2>
            <p>${escapeHtml(category.note || "")}</p>
          </div>
          <div class="items-grid">
            ${category.items.map((item) => renderItem(category, item)).join("")}
          </div>
        </section>
      `
    )
    .join("");

  setupRevealObserver();
  setupNavHighlightObserver();
  applyHashOnRender(categories);
}

/* ---------------------------------------------------------------------- */
/* Observers                                                              */
/* ---------------------------------------------------------------------- */

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function setupRevealObserver() {
  revealObserver?.disconnect();
  const sectionEls = [...document.querySelectorAll(".menu-section")];

  if (!("IntersectionObserver" in window)) {
    sectionEls.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
  );

  sectionEls.forEach((el) => revealObserver.observe(el));
}

function setupNavHighlightObserver() {
  navObserver?.disconnect();
  const sectionEls = [...document.querySelectorAll(".menu-section")];
  if (!sectionEls.length || !("IntersectionObserver" in window)) return;

  navObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        setActiveNavButton(entry.target.id);
      });
    },
    { rootMargin: "-170px 0px -70% 0px", threshold: 0 }
  );

  sectionEls.forEach((el) => navObserver.observe(el));
}

/* ---------------------------------------------------------------------- */
/* Hash navigation (deep links like /#grill)                              */
/* ---------------------------------------------------------------------- */

function applyHashOnRender(categories) {
  const hash = decodeURIComponent(location.hash.replace("#", ""));
  if (!hash) return;
  const target = document.getElementById(hash);
  if (target && categories.some((c) => c.id === hash)) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start", behavior: "auto" });
      setActiveNavButton(hash);
    });
  }
}

window.addEventListener("hashchange", () => {
  const hash = decodeURIComponent(location.hash.replace("#", ""));
  const target = hash && document.getElementById(hash);
  if (target) {
    target.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setActiveNavButton(hash);
  }
});

/* ---------------------------------------------------------------------- */
/* Quick view modal                                                       */
/* ---------------------------------------------------------------------- */

function findItemById(id) {
  for (const category of menu.categories) {
    const item = category.items.find((it) => it.id === id);
    if (item) return { category, item };
  }
  return null;
}

function openModal(id) {
  const found = findItemById(id);
  if (!found) return;
  const { category, item } = found;

  lastFocusedBeforeModal = document.activeElement;

  const photo = item.image
    ? `<picture class="item-photo-wrap">
        <source srcset="assets/dishes/${item.image}.webp" type="image/webp">
        <img src="assets/dishes/${item.image}.jpg" alt="${escapeHtml(item.name)}"
          onerror="this.closest('.item-photo-wrap')?.classList.add('img-broken')"
          width="${item.imgW || 800}" height="${item.imgH || 800}">
      </picture>`
    : `<div class="modal-photo-fallback" aria-hidden="true"><span>🐉</span></div>`;

  els.modalDialog.innerHTML = `
    <button type="button" class="modal-close" id="itemModalClose" aria-label="Закрити">✕</button>
    <div class="modal-photo">${photo}</div>
    <div class="modal-body">
      <p class="modal-category">${escapeHtml(category.name)}</p>
      <div class="modal-top">
        <h2 id="itemModalTitle">${escapeHtml(item.name)}</h2>
        <span class="item-price">${priceLabel(item.price)}</span>
      </div>
      ${item.description ? `<p class="modal-desc">${escapeHtml(item.description)}</p>` : ""}
      ${item.weight ? `<p class="modal-weight">${escapeHtml(item.weight)}</p>` : ""}
    </div>
  `;

  els.modal.hidden = false;
  document.body.classList.add("modal-open");
  document.getElementById("itemModalClose").addEventListener("click", closeModal);
  els.modalDialog.querySelector(".modal-close")?.focus();
}

function closeModal() {
  els.modal.hidden = true;
  document.body.classList.remove("modal-open");
  els.modalDialog.innerHTML = "";
  lastFocusedBeforeModal?.focus?.();
}

els.modal.addEventListener("click", (event) => {
  if (event.target === els.modal) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.modal.hidden) closeModal();
  if (event.key === "Tab" && !els.modal.hidden) trapFocus(event);
});

function trapFocus(event) {
  const focusable = els.modalDialog.querySelectorAll(
    'button, [href], input, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

els.menuGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".menu-item");
  if (card) openModal(card.dataset.itemId);
});

els.menuGrid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".menu-item");
  if (!card) return;
  event.preventDefault();
  openModal(card.dataset.itemId);
});

/* ---------------------------------------------------------------------- */
/* Controls: search & filters                                             */
/* ---------------------------------------------------------------------- */

function clearSearch() {
  searchTerm = "";
  els.search.value = "";
  renderSections();
  els.search.focus();
}

const debouncedRender = debounce(() => renderSections(), 180);

els.search.addEventListener("input", (event) => {
  searchTerm = event.target.value;
  debouncedRender();
});

els.searchClear.addEventListener("click", clearSearch);

els.quickTabs.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    activeFilter = button.dataset.filter;
    els.quickTabs.forEach((tab) => {
      tab.classList.remove("active");
      tab.setAttribute("aria-pressed", "false");
    });
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
    renderSections();
  });
});

/* ---------------------------------------------------------------------- */
/* Data loading & bootstrap                                               */
/* ---------------------------------------------------------------------- */

function renderLoading() {
  els.menuGrid.innerHTML = `
    <div class="loading-state" aria-hidden="true">
      ${Array.from({ length: 3 })
        .map(
          () => `
        <div class="skeleton-section">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-grid">
            ${Array.from({ length: 4 }).map(() => `<div class="skeleton-card"></div>`).join("")}
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

function renderError(message) {
  els.menuGrid.innerHTML = `
    <div class="empty error-state">
      <p class="empty-title">Меню тимчасово недоступне</p>
      <p class="empty-hint">${escapeHtml(message)}</p>
      <button type="button" class="empty-reset" id="retryLoadBtn">Спробувати ще раз</button>
    </div>`;
  document.getElementById("retryLoadBtn")?.addEventListener("click", init);
}

function validateMenuData(data) {
  if (!data || !Array.isArray(data.categories)) {
    throw new Error("Некоректний формат даних меню.");
  }
  data.categories = data.categories.filter(
    (category) => category && Array.isArray(category.items) && category.items.length > 0
  );
  if (!data.categories.length) {
    throw new Error("Меню порожнє.");
  }
  data.categories.forEach((category) => {
    category.items = category.items.filter((item) => item && item.name);
    category.items.forEach((item) => {
      if (item.price === undefined || item.price === null || item.price === "") {
        item.price = "уточнюйте";
      }
    });
  });
  return data;
}

async function loadMenu() {
  const response = await fetch(MENU_DATA_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Не вдалося завантажити меню (${response.status}).`);
  }
  const data = await response.json();
  return validateMenuData(data);
}

async function init() {
  renderLoading();
  try {
    menu = await loadMenu();
    renderSections();
  } catch (error) {
    console.error("Menu load failed:", error);
    renderError(
      error instanceof SyntaxError
        ? "Дані меню пошкоджені. Спробуйте оновити сторінку."
        : "Перевірте з'єднання з інтернетом і спробуйте ще раз."
    );
  }
}

init();
