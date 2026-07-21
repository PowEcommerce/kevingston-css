/*
 * Kevingston — Color picker de la card de producto (compose mode)
 * -----------------------------------------------------------------
 * Los productos de cada color se cargan como productos INDEPENDIENTES y se
 * relacionan por los primeros 5 dígitos del SKU. Este script:
 *   1. Descarga el mapa hosteado (color-map.json): sku5 -> [ {id,url,color,name} ].
 *   2. En cada card de la grilla lee su data-product-id, busca su grupo y
 *      renderiza un círculo de color por cada producto hermano.
 *   3. Marca el círculo del producto actual como activo; cada círculo linkea
 *      al producto hermano.
 *
 * Se inyecta vía un code-block (Custom section) en category/search/home.
 * Soporta paginación infinita (MutationObserver). Todo el CSS de los swatches
 * vive en theme.css (.kv-swatches / .kv-swatch).
 *
 * Editar => git push => visible en ~10 min (o bumpear ?v=N en el <script src>).
 */
(function () {
  "use strict";

  var MAP_URL = "https://powecommerce.github.io/kevingston-css/color-map.json";
  var CARD_SELECTOR = ".js-item-product[data-product-id]";
  var DONE_ATTR = "data-kv-cp"; // marca de card ya procesada

  // productId (string) -> { color, siblings: [ {id,url,color,name} ] }
  var byId = null;

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  function buildIndex(map) {
    var idx = Object.create(null);
    var groups = (map && map.groups) || {};
    Object.keys(groups).forEach(function (sku5) {
      var items = groups[sku5];
      if (!Array.isArray(items) || items.length < 2) return; // 1 solo color => sin picker
      items.forEach(function (item) {
        if (item && item.id != null) {
          idx[String(item.id)] = { color: item.color, siblings: items };
        }
      });
    });
    return idx;
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  function renderCard(card) {
    if (!card || card.getAttribute(DONE_ATTR)) return;
    var pid = card.getAttribute("data-product-id");
    if (!pid) return;

    var entry = byId[pid];
    if (!entry) return; // producto sin grupo => nada que mostrar

    card.setAttribute(DONE_ATTR, "1");

    var list = document.createElement("div");
    list.className = "kv-swatches";

    entry.siblings.forEach(function (sib) {
      if (!sib || sib.color == null) return;
      var isActive = String(sib.id) === pid;
      var dot = document.createElement("a");
      dot.className = "kv-swatch" + (isActive ? " is-active" : "");
      dot.style.setProperty("--kv-swatch-color", sib.color);
      dot.setAttribute("title", sib.name || "");
      dot.setAttribute("aria-label", sib.name || "");
      if (isActive) {
        dot.setAttribute("aria-current", "true");
        dot.setAttribute("href", "javascript:void(0)");
        dot.addEventListener("click", function (e) { e.preventDefault(); });
      } else {
        dot.setAttribute("href", sib.url || "#");
      }
      list.appendChild(dot);
    });

    if (!list.children.length) return;

    // Insertar justo DESPUÉS del <a> del producto (fuera del link, para que el
    // click en el swatch no dispare la navegación a la card actual).
    var link = card.querySelector("a.product-item-link");
    if (link && link.parentNode) {
      link.parentNode.insertBefore(list, link.nextSibling);
    } else {
      var info =
        card.querySelector(".product-item-information-inner") ||
        card.querySelector(".product-item-information") ||
        card;
      info.appendChild(list);
    }
  }

  function renderAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var cards = scope.querySelectorAll(CARD_SELECTOR);
    for (var i = 0; i < cards.length; i++) renderCard(cards[i]);
    // Si root ES una card (nodo agregado por infinite scroll)
    if (root && root.matches && root.matches(CARD_SELECTOR)) renderCard(root);
  }

  /* ------------------------------------------------------------------ */
  /* Infinite scroll                                                     */
  /* ------------------------------------------------------------------ */
  function observe() {
    if (!("MutationObserver" in window)) return;
    var mo = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        for (var n = 0; n < added.length; n++) {
          var node = added[n];
          if (node.nodeType === 1) renderAll(node);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  function init() {
    fetch(MAP_URL, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (map) {
        if (!map) return;
        byId = buildIndex(map);
        renderAll(document);
        observe();
      })
      .catch(function () { /* silencioso: sin mapa, no hay swatches */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
