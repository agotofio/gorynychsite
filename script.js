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
  menuUpdated: document.getElementById("menuUpdated"),
  resetFilters: document.getElementById("resetFilters"),
  backToTop: document.getElementById("backToTop"),
  brand: document.querySelector(".brand"),
  quickTabs: [...document.querySelectorAll(".quick-tabs button")],
  modal: document.getElementById("itemModal"),
  modalDialog: document.getElementById("itemModalDialog"),
};

function ensureHostedControls() {
  if (!els.menuUpdated) {
    const introMeta = document.querySelector(".intro-meta");
    if (introMeta) {
      const updated = document.createElement("span");
      updated.id = "menuUpdated";
      updated.textContent = "оновлення меню";
      introMeta.append(updated);
      els.menuUpdated = updated;
    }
  }

  const quickTabs = document.querySelector(".quick-tabs");
  const extraFilters = [
    ["under-200", "До 200 ₴"],
    ["for-company", "На компанію"],
    ["beer", "До пива"],
    ["cocktails", "Коктейлі"],
    ["desserts", "Десерти"],
    ["unknown", "Невідоме"],
  ];
  extraFilters.forEach(([filter, label]) => {
    if (!quickTabs || quickTabs.querySelector(`[data-filter="${filter}"]`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.filter = filter;
    button.setAttribute("aria-pressed", "false");
    button.textContent = label;
    quickTabs.append(button);
  });
  els.quickTabs = [...document.querySelectorAll(".quick-tabs button")];

  if (!els.resetFilters && quickTabs) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "reset-filters";
    reset.id = "resetFilters";
    reset.disabled = true;
    reset.textContent = "Очистити фільтри";
    quickTabs.parentElement?.append(reset);
    els.resetFilters = reset;
  }

  if (!els.backToTop) {
    const backToTop = document.createElement("button");
    backToTop.type = "button";
    backToTop.className = "back-to-top";
    backToTop.id = "backToTop";
    backToTop.hidden = true;
    backToTop.setAttribute("aria-label", "Повернутися нагору");
    backToTop.innerHTML = "↑ <span>Нагору</span>";
    document.body.append(backToTop);
    els.backToTop = backToTop;
  }
}

ensureHostedControls();

let menu = null;
let activeFilter = location.hash === "#unknown" ? "unknown" : "all";
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
    .replace(/[«»"'`’‘ʼ]/g, "")
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
    [
      category.name,
      item.name,
      ...(item.aliases || []),
      item.description,
      item.ingredients,
      ...(item.photos || []).map((photo) => photo.source),
      item.weight,
      String(item.price ?? ""),
    ]
      .filter(Boolean)
      .join(" ")
  );
  return haystack.includes(term);
}

function itemMatchesFilter(category, item) {
  return itemMatchesFilterValue(activeFilter, category, item);
}

function itemMatchesFilterValue(filter, category, item) {
  if (filter === "unknown") return category.id === "unknown";
  if (item.pending || category.id === "unknown") return false;
  if (filter === "all") return true;
  if (filter === "food") return category.type === "food";
  if (filter === "drinks") return category.type === "drinks";
  if (filter === "photo") return Boolean(item.image);
  if (filter === "under-200") return getPriceNumbers(item.price).some((price) => price <= 200);
  if (filter === "for-company") return (item.tags || []).includes("for-company");
  if (filter === "beer") return category.type === "food" && (item.tags || []).includes("beer-snack");
  if (filter === "cocktails") return (item.tags || []).includes("cocktail");
  if (filter === "desserts") return category.id === "desserts";
  return true;
}

function getPriceNumbers(price) {
  return String(price ?? "")
    .split("/")
    .map((part) => Number.parseFloat(part.replace(",", ".").replace(/[^\d.]/g, "")))
    .filter((value) => Number.isFinite(value));
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
          data-target="${escapeHtml(category.id)}"
          aria-label="${escapeHtml(`${category.name}, ${category.items.length} ${pluralizeResults(category.items.length)}`)}"
          aria-current="${category.id === activeId ? "true" : "false"}">
          <span>${escapeHtml(category.name)}</span>
          <span class="nav-count" aria-hidden="true">${category.items.length}</span>
        </button>
      `
    )
    .join("");

  els.sectionNav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.target);
      setActiveNavButton(button.dataset.target);
      scrollToMenuSection(target, prefersReducedMotion() ? "auto" : "smooth");
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
  const navContainer = els.sectionNav.closest(".section-nav");
  const button = [...els.sectionNav.querySelectorAll('button')]
    .find(element => element.dataset.target === targetId);
  if (!button || !navContainer) return;
  // Scroll only the category list. scrollIntoView also moves the page and
  // can cancel a long menu jump when the observer highlights a new section.
  const horizontal = window.matchMedia('(max-width: 1100px)').matches;
  const scroller = horizontal ? els.sectionNav : navContainer;
  const bounds = scroller.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  if (horizontal) {
    if (rect.left < bounds.left + 8) scroller.scrollLeft += rect.left - bounds.left - 8;
    else if (rect.right > bounds.right - 8) scroller.scrollLeft += rect.right - bounds.right + 8;
  } else {
    if (rect.top < bounds.top + 8) scroller.scrollTop += rect.top - bounds.top - 8;
    else if (rect.bottom > bounds.bottom - 8) scroller.scrollTop += rect.bottom - bounds.bottom + 8;
  }
}

function renderItem(category, item) {
  const hasImage = Boolean(item.image);
  const headingTag = item.menuGroup ? "h4" : "h3";
  const photo = hasImage
    ? `<picture class="item-photo-wrap">
        <source srcset="assets/dishes/thumbs/${item.image}.avif" type="image/avif">
        <source srcset="assets/dishes/thumbs/${item.image}.webp 480w, assets/dishes/${item.image}.webp 960w"
          sizes="(max-width: 760px) 92px, 128px" type="image/webp">
        <img class="item-photo" src="assets/dishes/${item.image}.jpg" alt="${escapeHtml(item.name)}"
          loading="lazy" decoding="async"
          onerror="this.closest('.item-photo-wrap')?.classList.add('img-broken')"
          width="${item.imgW || 400}" height="${item.imgH || 400}">
      </picture>`
    : "";

  return `
    <article class="menu-item ${hasImage ? "" : "no-photo"}" data-item-id="${escapeHtml(item.id)}" tabindex="0" role="button"
      aria-label="Детальніше: ${escapeHtml(item.name)}">
      ${photo}
      <div class="item-body">
        <div class="item-top">
          <${headingTag} class="item-name">${escapeHtml(item.name)}</${headingTag}>
          ${priceMarkup(item)}
        </div>
        ${item.description ? `<p class="item-desc">${escapeHtml(item.description)}</p>` : ""}
        ${item.weight ? `<div class="item-meta"><span>${escapeHtml(item.weight)}</span></div>` : ""}
        ${item.portionNote ? `<p class="item-desc">Об’єм порцій уточнюється.</p>` : ""}
      </div>
    </article>
  `;
}

function renderCategoryItems(category) {
  let previousGroup = "";
  return category.items.map((item) => {
    const group = item.menuGroup || "";
    const heading = group && group !== previousGroup
      ? `<h3 class="menu-group-heading">${escapeHtml(group)}</h3>`
      : "";
    previousGroup = group;
    return heading + renderItem(category, item);
  }).join("");
}

function priceMarkup(item) {
  if (item.pending) return `<span class="item-price pending-price">Уточнюється</span>`;
  const rawPrice = String(item.price ?? "уточнюйте").trim();
  const priceParts = rawPrice.split(/\s*\/\s*/).filter(Boolean);
  const unitParts = String(item.weight ?? "").split(/\s*\/\s*/).filter(Boolean);
  const sharedUnit = unitParts.at(-1)?.match(/\s(мл|л|кг|г)$/)?.[1];
  if (sharedUnit) {
    unitParts.forEach((part, index) => {
      if (/^\d+(?:[.,]\d+)?$/.test(part)) unitParts[index] = `${part} ${sharedUnit}`;
    });
  }

  if (priceParts.length > 1 && priceParts.length === unitParts.length) {
    const ariaLabel = priceParts
      .map((price, index) => `${price} гривень за ${unitParts[index]}`)
      .join("; ");
    return `
      <span class="item-price price-breakdown" aria-label="${escapeHtml(ariaLabel)}">
        ${priceParts
          .map(
            (price, index) => `
              <span class="price-part">
                <b>${escapeHtml(price)}</b>
                <small>${escapeHtml(unitParts[index])}</small>
              </span>`
          )
          .join("")}
      </span>`;
  }

  return `<span class="item-price">${priceLabel(rawPrice)}</span>`;
}

function renderStats(categories) {
  const itemCount = categories.reduce((sum, c) => sum + c.items.length, 0);
  const photoCount = categories.reduce(
    (sum, c) => sum + c.items.filter((item) => item.image).length,
    0
  );
  els.stats.innerHTML = `
    <span>${itemCount} ${pluralizeResults(itemCount)}</span>
    <span>${photoCount} з фото</span>
    <span>${categories.length} ${pluralizeWords(categories.length, "розділ", "розділи", "розділів")}</span>
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
  return pluralizeWords(n, "позиція", "позиції", "позицій");
}

function pluralizeWords(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return few;
  return many;
}

function updateFilterAvailability() {
  const term = normalize(searchTerm);
  let activeFilterAvailable = activeFilter === "all";
  els.quickTabs.forEach((button) => {
    const filter = button.dataset.filter;
    if (filter === "all") {
      button.disabled = false;
      return;
    }
    const hasMatch = menu.categories.some((category) =>
      category.items.some(
        (item) => itemMatchesFilterValue(filter, category, item) && itemMatchesSearch(category, item, term)
      )
    );
    if (filter === activeFilter) activeFilterAvailable = hasMatch;
    button.disabled = !hasMatch;
    button.setAttribute("aria-disabled", String(!hasMatch));
  });

  // A search can make the currently selected filter empty. Returning to
  // "all" keeps the visitor from being stranded on a disabled active tab.
  if (!activeFilterAvailable) {
    activeFilter = "all";
    els.quickTabs.forEach((button) => {
      const isActive = button.dataset.filter === "all";
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }
  if (els.resetFilters) {
    els.resetFilters.disabled = !searchTerm && activeFilter === "all";
  }
}

function renderSections() {
  updateFilterAvailability();
  const categories = getVisibleCategories();
  const itemCount = categories.reduce((sum, c) => sum + c.items.length, 0);

  renderStats(categories);
  renderSearchStatus(searchTerm, itemCount);

  if (!categories.length) {
    els.sectionNav.innerHTML = "";
    els.menuGrid.innerHTML = `
      <div class="empty">
        <p class="empty-title">Нічого не знайдено</p>
        <p class="empty-hint">Спробуйте інший запит або очистіть пошук.</p>
        <button type="button" class="empty-reset" id="emptyResetBtn">Очистити пошук та фільтри</button>
      </div>`;
    document.getElementById("emptyResetBtn")?.addEventListener("click", resetMenuView);
    revealObserver?.disconnect();
    navObserver?.disconnect();
    return;
  }

  renderNav(categories);
  els.menuGrid.innerHTML = categories
    .map(
      (category) => `
        <section class="menu-section" id="${escapeHtml(category.id)}" aria-labelledby="${escapeHtml(category.id)}-heading">
          <div class="section-head">
            <h2 id="${escapeHtml(category.id)}-heading">${escapeHtml(category.name)}</h2>
            <p>${escapeHtml(category.note || "")}</p>
          </div>
          <div class="items-grid">
            ${renderCategoryItems(category)}
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

function scrollToMenuSection(target, behavior = "auto") {
  if (!target) return;
  // Reveal transforms must not change the destination while scrolling.
  target.style.transition = "none";
  target.classList.add("is-visible");
  target.style.transform = "none";
  updateHeaderHeight();
  // Wrapped filters change the sticky header height on desktop.
  const stickyBottom = Math.max(0, ...[...document.querySelectorAll('.topbar, .controls, .section-nav')].map(element => {
    const style = getComputedStyle(element);
    if (style.position !== 'sticky') return 0;
    // The desktop category sidebar does not overlap menu content.
    if (element.classList.contains('section-nav') && window.innerWidth > 1100) return 0;
    return (parseFloat(style.top) || 0) + element.getBoundingClientRect().height;
  }));
  target.style.scrollMarginTop = `${stickyBottom + 14}px`;
  target.scrollIntoView({ block: 'start', behavior });
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

  const headerHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
  const bar = document.querySelector(window.innerWidth <= 1100 ? '.section-nav' : '.controls');
  const barHeight = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().height : 0;
  const topInset = Math.min(Math.ceil(headerHeight + barHeight), Math.floor(window.innerHeight * 0.55));
  navObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        setActiveNavButton(entry.target.id);
      });
    },
    { rootMargin: `-${topInset}px 0px -${Math.floor(window.innerHeight * 0.2)}px 0px`, threshold: 0 }
  );

  sectionEls.forEach((el) => navObserver.observe(el));
}

/* ---------------------------------------------------------------------- */
/* Hash navigation (deep links like /#grill)                              */
/* ---------------------------------------------------------------------- */

function applyHashOnRender(categories) {
  const hash = getHashId();
  if (!hash) return;
  const target = document.getElementById(hash);
  if (target && categories.some((c) => c.id === hash)) {
    requestAnimationFrame(() => {
      scrollToMenuSection(target);
      setActiveNavButton(hash);
    });
  }
}

window.addEventListener("hashchange", () => {
  const hash = getHashId();
  const target = hash && document.getElementById(hash);
  if (target) {
    scrollToMenuSection(target, prefersReducedMotion() ? "auto" : "smooth");
    setActiveNavButton(hash);
  }
});

function getHashId() {
  const rawHash = location.hash.slice(1);
  if (!rawHash) return "";
  try {
    return decodeURIComponent(rawHash);
  } catch {
    return "";
  }
}

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
  const ingredientText = item.ingredients;
  const photos = item.photos?.length ? item.photos : item.image ? [{image:item.image,width:item.imgW,height:item.imgH}] : [];

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
        ${priceMarkup(item)}
      </div>
      ${
        item.description && item.description !== ingredientText
          ? `<p class="modal-desc">${escapeHtml(item.description)}</p>`
          : ""
      }
      ${
        ingredientText
          ? `<p class="modal-ingredients"><strong>Склад:</strong> ${escapeHtml(ingredientText)}</p>`
          : `<p class="modal-ingredients">Склад уточнюйте у персоналу.</p>`
      }
      ${item.weight ? `<p class="modal-weight">${escapeHtml(item.weight)}</p>` : ""}
      ${item.portionNote ? `<p class="modal-weight">Об’єм порцій уточнюється.</p>` : ""}
      ${item.ingredientsSource ? `<p class="photo-source">Джерело складу: ${escapeHtml(item.ingredientsSource)}.</p>` : ""}
      ${photos.length ? `<p class="photo-source" id="photoSource">${escapeHtml(photos[0].source || "")}</p>` : ""}
      ${photos.length > 1 ? `<div class="photo-gallery" aria-label="Фотографії позиції">${photos.map((entry,index)=>`<button type="button" class="gallery-thumb ${index===0?'selected':''}" data-photo-index="${index}" aria-pressed="${index===0}" aria-label="Фото ${index+1}: ${escapeHtml(entry.source || item.name)}"><img src="assets/dishes/thumbs/${entry.image}.webp" alt="" loading="lazy"></button>`).join('')}</div>` : ""}
    </div>
  `;

  els.modal.hidden = false;
  els.modal.removeAttribute("aria-label");
  els.modal.setAttribute("aria-labelledby", "itemModalTitle");
  document.body.classList.add("modal-open");
  document.getElementById("itemModalClose").addEventListener("click", closeModal);
  els.modalDialog.querySelectorAll('[data-photo-index]').forEach(button=>button.addEventListener('click',()=>{
    const entry=photos[Number(button.dataset.photoIndex)];
    const picture=els.modalDialog.querySelector('.modal-photo picture');
    picture.querySelector('source').srcset=`assets/dishes/${entry.image}.webp`;
    const img=picture.querySelector('img');img.src=`assets/dishes/${entry.image}.jpg`;
    img.width=entry.width || 800;img.height=entry.height || 800;
    picture.classList.remove('img-broken');
    els.modalDialog.querySelector('#photoSource').textContent=entry.source || '';
    els.modalDialog.querySelectorAll('[data-photo-index]').forEach(thumb=>{
      thumb.classList.toggle('selected',thumb===button);thumb.setAttribute('aria-pressed',String(thumb===button));
    });
  }));
  els.modalDialog.querySelector(".modal-close")?.focus();
}

function closeModal() {
  els.modal.hidden = true;
  els.modal.removeAttribute("aria-labelledby");
  els.modal.setAttribute("aria-label", "Деталі позиції меню");
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
  resetMenuView({ focusSearch: true });
}

function syncQuickTabs() {
  els.quickTabs.forEach((tab) => {
    const isActive = tab.dataset.filter === activeFilter;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });
}

function resetMenuView({ focusSearch = false } = {}) {
  clearTimeout(debounceHandle);
  searchTerm = "";
  els.search.value = "";
  activeFilter = "all";
  syncQuickTabs();
  renderSections();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  if (focusSearch) els.search.focus();
}

const debouncedRender = debounce(() => renderSections(), 180);

els.search.addEventListener("input", (event) => {
  searchTerm = event.target.value;
  debouncedRender();
});

els.searchClear.addEventListener("click", clearSearch);
els.resetFilters.addEventListener("click", resetMenuView);
els.brand.addEventListener("click", (event) => {
  event.preventDefault();
  resetMenuView();
});

els.quickTabs.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    activeFilter = button.dataset.filter;
    syncQuickTabs();
    renderSections();
  });
});

/* ---------------------------------------------------------------------- */
/* Data loading & bootstrap                                               */
/* ---------------------------------------------------------------------- */

function renderLoading() {
  els.sectionNav.innerHTML = "";
  els.stats.innerHTML = "";
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
  els.sectionNav.innerHTML = "";
  els.stats.innerHTML = "";
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
  const usedCategoryIds = new Set();
  const usedItemIds = new Set();

  data.categories = data.categories
    .filter((category) => category && Array.isArray(category.items))
    .map((category, categoryIndex) => {
      const rawCategoryId = String(category.id ?? "").trim();
      const baseCategoryId = /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rawCategoryId)
        ? rawCategoryId
        : `category-${categoryIndex + 1}`;
      let categoryId = baseCategoryId;
      let categorySuffix = 2;
      while (usedCategoryIds.has(categoryId)) {
        categoryId = `${baseCategoryId}-${categorySuffix}`;
        categorySuffix += 1;
      }
      usedCategoryIds.add(categoryId);

      const normalizedCategory = {
        ...category,
        id: categoryId,
        name: String(category.name ?? "").trim() || `Розділ ${categoryIndex + 1}`,
        note: String(category.note ?? "").trim(),
        type: category.type === "drinks" ? "drinks" : "food",
      };

      normalizedCategory.items = category.items
        .filter((item) => item && String(item.name ?? "").trim())
        .map((item, itemIndex) => {
          const rawItemId = String(item.id ?? "").trim();
          const baseItemId = /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rawItemId)
            ? rawItemId
            : `${categoryId}-item-${itemIndex + 1}`;
          let itemId = baseItemId;
          let itemSuffix = 2;
          while (usedItemIds.has(itemId)) {
            itemId = `${baseItemId}-${itemSuffix}`;
            itemSuffix += 1;
          }
          usedItemIds.add(itemId);

          const width = Number(item.imgW);
          const height = Number(item.imgH);
          const description = String(item.description ?? "").trim();
          const ingredients = String(item.ingredients ?? "").trim();
          return {
            ...item,
            id: itemId,
            available: item.available !== false,
            name: String(item.name).trim(),
            description,
            ingredients,
            weight: String(item.weight ?? "").trim(),
            image:
              typeof item.image === "string" && /^[A-Za-z0-9_-]+$/.test(item.image.trim())
                ? item.image.trim()
                : "",
            price:
              item.price === undefined || item.price === null || String(item.price).trim() === ""
                ? "уточнюйте"
                : String(item.price).trim(),
            imgW: Number.isFinite(width) && width > 0 ? Math.min(Math.round(width), 4000) : 400,
            imgH: Number.isFinite(height) && height > 0 ? Math.min(Math.round(height), 4000) : 400,
          };
        })
        .filter((item) => item.available);

      return normalizedCategory;
    })
    .filter((category) => category.items.length > 0);

  if (!data.categories.length) throw new Error("Меню порожнє.");
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

function renderMenuUpdatedDate() {
  const updated = menu?.meta?.updated;
  if (!els.menuUpdated || !updated) return;

  const date = new Date(`${updated}T00:00:00`);
  if (Number.isNaN(date.getTime())) return;

  els.menuUpdated.textContent = `оновлено ${new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)}`;
}

function updateBackToTop() {
  if (!els.backToTop) return;
  els.backToTop.hidden = window.scrollY < 520;
}

function registerOfflineCache() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Offline cache is unavailable:", error);
  });
}

async function init() {
  renderLoading();
  try {
    menu = await loadMenu();
    syncQuickTabs();
    renderMenuUpdatedDate();
    renderSections();
    registerOfflineCache();
  } catch (error) {
    console.error("Menu load failed:", error);
    renderError(
      error instanceof SyntaxError
        ? "Дані меню пошкоджені. Спробуйте оновити сторінку."
        : error.message === "Меню порожнє."
        ? "У файлі меню немає доступних позицій."
        : "Перевірте з'єднання з інтернетом і спробуйте ще раз."
    );
  }
}

els.backToTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
});
window.addEventListener("scroll", updateBackToTop, { passive: true });
updateBackToTop();

function updateHeaderHeight() {
  const header = document.querySelector(".topbar");
  if (!header) return;
  const headerHeight = Math.ceil(header.getBoundingClientRect().height);
  const controls = document.querySelector(".controls");
  const controlsHeight = controls && getComputedStyle(controls).position === "sticky"
    ? Math.ceil(controls.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty("--topbar-height", `${headerHeight}px`);
  document.documentElement.style.setProperty("--menu-sticky-offset", `${headerHeight + controlsHeight + 14}px`);
}
updateHeaderHeight();
window.addEventListener('resize', () => {
  updateHeaderHeight();
  setupNavHighlightObserver();
});
if ("ResizeObserver" in window) {
  const layoutObserver = new ResizeObserver(updateHeaderHeight);
  layoutObserver.observe(document.querySelector(".topbar"));
  layoutObserver.observe(document.querySelector(".controls"));
} else {
  window.addEventListener("resize", updateHeaderHeight);
}

init();
