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

    var sibs = entry.siblings || [];
    if (sibs.length < 2) return;

    card.setAttribute(DONE_ATTR, "1");

    // El swatch del producto actual (seleccionado) va SIEMPRE primero; el resto
    // en su orden original. Se muestran como máximo MAX; el resto va como "+N".
    var selected = null;
    var rest = [];
    sibs.forEach(function (s) {
      if (String(s.id) === pid) selected = s; else rest.push(s);
    });
    var ordered = (selected ? [selected] : []).concat(rest);

    var MAX = 3;
    var shown = ordered.slice(0, MAX);
    var remaining = ordered.length - shown.length;

    var list = document.createElement("div");
    list.className = "kv-swatches";

    shown.forEach(function (sib) {
      var isActive = String(sib.id) === pid;
      var dot = document.createElement("a");
      dot.className = "kv-swatch" + (isActive ? " is-active" : "");
      if (sib.color) dot.style.setProperty("--kv-swatch-color", sib.color);
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

    // Contador "+N" de colores restantes (igual que en Figma)
    if (remaining > 0) {
      var more = document.createElement("span");
      more.className = "kv-swatch-more";
      more.textContent = "+" + remaining;
      list.appendChild(more);
    }

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
  /* Quick-shop modal: slider vertical de TODAS las imágenes del producto */
  /* Datos: product-images.json (productId -> [urls]). El modal nativo    */
  /* trae 1 sola imagen; se oculta y se apilan todas en scroll vertical.  */
  /* ------------------------------------------------------------------ */
  var IMAGES_URL = "https://powecommerce.github.io/kevingston-css/product-images.json";

  function setupQuickshopGallery(imagesMap) {
    var container = document.querySelector("#quickshop-modal .js-quickshop-container");
    if (!container) return;

    // Slider vertical con TODAS las imágenes del producto
    function renderGallery(pid) {
      var imgs = imagesMap[pid];
      var wrap = container.querySelector(".quickshop-image-container");
      if (!wrap || !imgs || !imgs.length) return;
      var native = wrap.querySelector(".js-quickshop-image-padding") ||
                   wrap.querySelector(".js-quickshop-img");
      if (native) native.style.display = "none";
      var prev = wrap.querySelector(".kv-gallery");
      if (prev) prev.parentNode.removeChild(prev);
      var gallery = document.createElement("div");
      gallery.className = "kv-gallery";
      imgs.forEach(function (src) {
        var im = document.createElement("img");
        im.className = "kv-gallery-img";
        im.loading = "lazy";
        im.alt = "";
        im.src = src;
        gallery.appendChild(im);
      });
      wrap.appendChild(gallery);
    }

    // Swatches de color = productos hermanos (SKU-5). Cada swatch = 1ra imagen
    // del producto. El actual va marcado; los demás linkean al hermano.
    function renderColors(pid) {
      var entry = byId && byId[pid];
      if (!entry || !entry.siblings || entry.siblings.length < 2) return;
      var group = container.querySelector(".js-color-variants-container");
      if (!group) return;

      // Ocultar los swatches nativos del color propio
      var natives = group.querySelectorAll(".btn-variant, .js-variant-button");
      for (var i = 0; i < natives.length; i++) natives[i].style.display = "none";

      var prev = group.querySelector(".kv-modal-swatches");
      if (prev) prev.parentNode.removeChild(prev);

      var row = document.createElement("div");
      row.className = "kv-modal-swatches";
      entry.siblings.forEach(function (sib) {
        var imgs = imagesMap[String(sib.id)];
        var src = imgs && imgs[0];
        var isActive = String(sib.id) === pid;
        var a = document.createElement("a");
        a.className = "kv-modal-swatch" + (isActive ? " is-active" : "");
        a.setAttribute("title", sib.name || "");
        a.setAttribute("aria-label", sib.name || "");
        if (isActive) {
          a.setAttribute("aria-current", "true");
          a.setAttribute("href", "javascript:void(0)");
          a.addEventListener("click", function (e) { e.preventDefault(); });
        } else {
          a.setAttribute("href", sib.url || "#");
        }
        if (src) {
          var im = document.createElement("img");
          im.src = src; im.alt = ""; im.loading = "lazy";
          a.appendChild(im);
        } else if (sib.color) {
          a.style.background = sib.color; // fallback si el hermano no tiene foto
        }
        row.appendChild(a);
      });
      group.appendChild(row);
    }

    // Cuotas (copiadas de la card) + precio sin impuestos (fetch al PDP).
    // El modal nativo no trae ninguno de los dos.
    var pdpCache = {};
    function renderInfo(pid) {
      var details = container.querySelector(".quickshop-details");
      var priceC = container.querySelector(".quickshop-price-container");
      if (!details || !priceC) return;

      var prev = details.querySelector(".kv-modal-info");
      if (prev) prev.parentNode.removeChild(prev);

      var info = document.createElement("div");
      info.className = "kv-modal-info";

      var card = document.querySelector('.js-item-product[data-product-id="' + pid + '"]');

      // Cuotas: texto de la card, reformateado "N cuotas sin interés de $X"
      var inst = card && card.querySelector(".product-item-installments");
      var instText = inst && inst.textContent.trim().replace(/\s+/g, " ");
      if (instText) {
        var m = instText.match(/(\d+)\s*x\s*(\$[\d.,]+)/i);
        var p1 = document.createElement("p");
        p1.className = "kv-modal-cuotas";
        p1.textContent = m ? (m[1] + " cuotas sin interés de " + m[2]) : instText;
        info.appendChild(p1);
      }

      priceC.parentNode.insertBefore(info, priceC.nextSibling);

      // Precio sin impuestos: desde el PDP (solo si el producto lo tiene)
      var link = card && card.querySelector("a.product-item-link");
      var url = link && link.getAttribute("href");
      if (!url) return;

      var apply = function (text) {
        if (text && !info.querySelector(".kv-modal-notax")) {
          var p2 = document.createElement("p");
          p2.className = "kv-modal-notax";
          p2.textContent = text;
          info.appendChild(p2);
        }
      };
      if (pdpCache[url] !== undefined) { apply(pdpCache[url]); return; }
      fetch(url, { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          if (!html) return;
          var doc = new DOMParser().parseFromString(html, "text/html");
          var nt = doc.querySelector(".price-without-taxes-container");
          var txt = nt ? nt.textContent.trim().replace(/\s+/g, " ") : "";
          pdpCache[url] = txt;
          apply(txt);
        })
        .catch(function () {});
    }

    // Cucardas/badges (descuento + promo) copiadas de la card, ARRIBA del título
    function renderBadges(pid) {
      var name = container.querySelector(".quickshop-name");
      if (!name || !name.parentNode) return;
      var prev = name.parentNode.querySelector(".kv-modal-badges");
      if (prev) prev.parentNode.removeChild(prev);

      var card = document.querySelector('.js-item-product[data-product-id="' + pid + '"]');
      if (!card) return;
      var src = card.querySelectorAll(".js-offer-label-private, .js-promotion-label-private");
      var row = document.createElement("div");
      row.className = "kv-modal-badges";
      for (var i = 0; i < src.length; i++) {
        var b = src[i];
        if (window.getComputedStyle(b).display === "none") continue; // no aplica
        var clone = b.cloneNode(true);
        clone.classList.remove("js-offer-label-private", "js-promotion-label-private");
        clone.style.display = "";
        row.appendChild(clone);
      }
      if (row.children.length) name.parentNode.insertBefore(row, name);
    }

    function render() {
      var pid = container.getAttribute("data-product-id");
      if (!pid) return;
      if (container.getAttribute("data-kv-modal") === pid) return; // ya procesado
      container.setAttribute("data-kv-modal", pid);
      renderGallery(pid);
      renderColors(pid);
      renderInfo(pid);
      renderBadges(pid);
    }

    if ("MutationObserver" in window) {
      new MutationObserver(render).observe(container, {
        attributes: true,
        attributeFilter: ["data-product-id"],
      });
    }
    render();
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

    fetch(IMAGES_URL, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.images) setupQuickshopGallery(data.images);
      })
      .catch(function () { /* silencioso: sin mapa de imágenes, queda la nativa */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
