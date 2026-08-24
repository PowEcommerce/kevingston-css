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

  // Preview del admin de TN: el storefront se renderiza dentro de un IFRAME (el sitio
  // publicado es top-level). Marcamos <html class="kv-preview"> lo antes posible para
  // que el CSS NO fuerce el look "blurred" (translúcido + texto blanco) en el editor
  // -> ahí el botón se ve con su color sólido normal (visible/editable). En el sitio
  // publicado no aplica y el blurred sigue funcionando.
  try { if (window.self !== window.top) document.documentElement.classList.add("kv-preview"); }
  catch (e) { document.documentElement.classList.add("kv-preview"); }

  var MAP_URL = "https://powecommerce.github.io/kevingston-css/color-map.json";
  var CARD_SELECTOR = ".js-item-product[data-product-id]";
  var DONE_ATTR = "data-kv-cp"; // marca de card ya procesada

  // productId (string) -> { color, siblings: [ {id,url,color,name} ] }
  var byId = null;
  var pdpMap = null;        // color-map crudo (groups por SKU5) — para el PDP
  var pdpImagesById = null; // product-images.json: id -> [urls]

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  function buildIndex(map) {
    var idx = Object.create(null);
    var groups = (map && map.groups) || {};
    Object.keys(groups).forEach(function (sku5) {
      var items = groups[sku5];
      if (!Array.isArray(items) || items.length < 1) return; // incluye grupos de 1 color (swatch único en la card)
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
    if (sibs.length < 1) return; // 1 color => se muestra igual (swatch único activo, sin "+N")

    card.setAttribute(DONE_ATTR, "1");

    // El swatch del producto actual (seleccionado) va SIEMPRE primero; el resto
    // en su orden original. Se muestran como máximo MAX; el resto va como "+N".
    var selected = null;
    var rest = [];
    sibs.forEach(function (s) {
      if (String(s.id) === pid) selected = s; else rest.push(s);
    });
    var ordered = (selected ? [selected] : []).concat(rest);

    var MAX = 3; // card de grilla: hasta 3 swatches + "+N" (Figma card 959-17367)
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
    initCardImageSpinners(scope);
    initInstallmentsText(scope);
    initCardPaginators(scope);
    disableProductLoops();
  }

  /* ------------------------------------------------------------------ */
  /* Sin loop infinito en los carruseles de productos de la home.        */
  /* El slider nativo (.js-products-list-swiper) arranca con loop:true;   */
  /* lo apagamos en runtime (loopDestroy saca los slides duplicados).     */
  /* Se dispara desde renderAll: el MutationObserver ve cuando el swiper   */
  /* agrega sus slides al inicializarse (lazy / cambio de tab).           */
  /* ------------------------------------------------------------------ */
  function disableProductLoops() {
    // .js-recommendations-swiper = carrusel de recomendados de la ficha (mismo
    // 4+peek que la home, pero su container ya tiene padding => offset 0).
    var swipers = document.querySelectorAll(".js-products-list-swiper, .js-recommendations-swiper");
    for (var i = 0; i < swipers.length; i++) {
      (function (el) {
        if (el._kvNoLoop) return;
        var sw = el.swiper;
        if (!sw || !sw.params) return;
        el._kvNoLoop = true;
        if (sw.params.loop) {
          try {
            sw.params.loop = false;
            if (sw.loopDestroy) sw.loopDestroy();
            sw.update();
            sw.slideTo(0, 0); // reset al inicio (loopDestroy deja un indice intermedio)
          } catch (e) {}
        }
        // Desktop: 4 cards + peek de la quinta (slidesPerView 4.2) — home y recomendados
        // de la ficha (elección del cliente: 4 + un poquito de la quinta). Editorial NO.
        try {
          var isEditorial = el.closest(
            "#ns-section-editorial_products, #ns-section-editorial_products_mujer"
          );
          var isRecommendations = el.classList.contains("js-recommendations-swiper");
          var off = isRecommendations ? 0 : 32; // recomendados: el container ya paddea
          var spv = isRecommendations ? 4.1 : 4.2; // recomendados 4.1, home 4.2 (4 + peek)
          if (!isEditorial) {
            var bp = sw.params.breakpoints;
            if (bp && bp["768"]) {
              bp["768"].slidesPerView = spv;
              bp["768"].slidesPerGroup = 1; // mover de a 1 card (no de a 4)
              bp["768"].slidesOffsetBefore = off; // arranca alineado; al scrollear sangra al borde
              bp["768"].slidesOffsetAfter = off; // al final, el ultimo producto no queda pegado al borde
            }
            if (window.innerWidth >= 768) {
              sw.params.slidesPerView = spv;
              sw.params.slidesPerGroup = 1;
              sw.params.slidesOffsetBefore = off;
              sw.params.slidesOffsetAfter = off;
              sw.update();
            } else if (isRecommendations) {
              // mobile: 1 card + peek (Figma 1407-27219: card 283 en 343)
              sw.params.slidesPerView = 1.25;
              sw.params.slidesPerGroup = 1;
              sw.params.spaceBetween = 16;
              sw.params.slidesOffsetBefore = 0;
              sw.params.slidesOffsetAfter = 0;
              sw.update();
            }
          }
        } catch (e) {}
      })(swipers[i]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Paginador de la card (mobile): barra segmentada abajo de la imagen. */
  /* El paginador nativo es 'fraction' (vacio). Armamos una barra con N   */
  /* segmentos y marcamos el activo segun .swiper-slide-active.           */
  /* ------------------------------------------------------------------ */
  function initCardPaginators(scope) {
    var conts = (scope || document).querySelectorAll(
      ".product-item-slider-container"
    );
    for (var i = 0; i < conts.length; i++) {
      (function (cont) {
        if (cont._kvBar) return;
        var wrap = cont.querySelector(".swiper-wrapper");
        if (!wrap) return;
        var slides = cont.querySelectorAll(
          ".product-item-slider-slide, .swiper-slide"
        );
        if (slides.length < 2) return;
        cont._kvBar = true;
        var bar = document.createElement("div");
        bar.className = "kv-cardbar";
        for (var s = 0; s < slides.length; s++)
          bar.appendChild(document.createElement("i"));
        cont.appendChild(bar);
        var segs = bar.children;
        var update = function () {
          var idx = 0;
          for (var k = 0; k < slides.length; k++) {
            if (slides[k].classList.contains("swiper-slide-active")) {
              idx = k;
              break;
            }
          }
          for (var j = 0; j < segs.length; j++)
            segs[j].classList.toggle("is-active", j === idx);
        };
        update();
        new MutationObserver(update).observe(wrap, {
          attributes: true,
          attributeFilter: ["class"],
          subtree: true,
        });
      })(conts[i]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Cuotas en la card: reformatear a "N cuotas s/interés de $XXX"        */
  /* (el theme arma "N x $XXX sin interés"; no editable sin fork/traduc). */
  /* ------------------------------------------------------------------ */
  function initInstallmentsText(scope) {
    var conts = (scope || document).querySelectorAll(
      ".product-item-installments"
    );
    for (var i = 0; i < conts.length; i++) {
      (function (c) {
        if (c._kvInst) return;
        var inner =
          c.querySelector(".js-max-installments.product-installments") || c;
        var amt = c.querySelector(".js-installment-amount");
        var val = c.querySelector(".js-installment-price");
        if (!amt || !val) return;
        var n = (amt.textContent || "").trim();
        var v = (val.textContent || "").trim();
        if (!n || !v) return;
        c._kvInst = true;
        var noInterest = inner.classList.contains("installment-no-interest");
        inner.textContent = noInterest
          ? n + " cuotas s/interés de " + v
          : n + " cuotas de " + v;
      })(conts[i]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Spinner por card mientras carga la imagen del producto              */
  /* Pone .kv-img-loading en el contenedor hasta el load del <img>.      */
  /* ------------------------------------------------------------------ */
  function initCardImageSpinners(scope) {
    var containers = (scope || document).querySelectorAll(
      ".product-item-image-container"
    );
    for (var i = 0; i < containers.length; i++) {
      (function (c) {
        if (c._kvSpin) return;
        c._kvSpin = true;
        var img = c.querySelector("img");
        if (!img) return;
        if (img.complete && img.naturalWidth > 0) return; // ya cargada
        c.classList.add("kv-img-loading");
        var done = function () {
          c.classList.remove("kv-img-loading");
        };
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      })(containers[i]);
    }
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

      function makeSwatch(sib) {
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
        return a;
      }

      // Activo primero, resto en orden. Máximo 4 swatches + botón "+N" (ver los
      // demás colores), igual que la ficha. El "+N" revela los ocultos.
      var active = null;
      entry.siblings.forEach(function (s) { if (String(s.id) === pid) active = s; });
      var ordered = active ? [active] : [];
      entry.siblings.forEach(function (s) { if (s !== active) ordered.push(s); });

      var MAX = 4;
      ordered.slice(0, MAX).forEach(function (sib) { row.appendChild(makeSwatch(sib)); });
      var remaining = ordered.slice(MAX);
      if (remaining.length) {
        var more = document.createElement("button");
        more.type = "button";
        more.className = "kv-modal-swatch-more";
        more.innerHTML = "+ " + remaining.length + "<span>colores</span>"; // igual que la PDP
        more.setAttribute("aria-label", "Ver los demás colores");
        // Abre el modal de "todos los colores" (mismo que la ficha) y CIERRA el
        // quick-shop, para no dejar los dos modales apilados.
        more.addEventListener("click", function () {
          openPdpColorsModal(ordered, active);
          var qs = document.getElementById("quickshop-modal");
          var cb = qs && qs.querySelector(".modal-close");
          if (cb) cb.click();
          else if (qs) qs.classList.remove("modal-show");
        });
        row.appendChild(more);
      }
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
        // "Precio sin impuestos" → "Precio sin impuestos nacionales" (el fetch al
        // PDP trae el texto crudo, sin la palabra que agrega initPdp en la ficha).
        if (text) text = text.replace(/Precio sin impuestos(?! nacionales)/i, "Precio sin impuestos nacionales");
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
      var src = card.querySelectorAll(
        ".js-offer-label-private, .js-promotion-label-private, .js-shipping-label-private, .js-stock-label-private"
      );
      var row = document.createElement("div");
      row.className = "kv-modal-badges";
      for (var i = 0; i < src.length; i++) {
        var b = src[i];
        if (window.getComputedStyle(b).display === "none") continue; // no aplica
        var cls, text = null;
        if (b.classList.contains("js-offer-label-private")) cls = "kv-badge-offer";
        else if (b.classList.contains("js-promotion-label-private")) cls = "kv-badge-promo";
        else if (b.classList.contains("js-shipping-label-private")) { cls = "kv-badge-shipping"; text = "ENVÍO GRATIS"; }
        else { cls = "kv-badge-stock"; text = "AGOTADO"; }
        // Clases propias: el estilo de la card está scopeado a .js-item-product
        // y no aplica en el modal.
        var clone = b.cloneNode(true);
        clone.className = "kv-badge " + cls;
        clone.removeAttribute("style");
        if (text !== null) clone.textContent = text; // reemplaza texto (traducción no editable)
        row.appendChild(clone);
      }
      if (row.children.length) name.parentNode.insertBefore(row, name);
    }

    // CTA: "Agregar al carrito" -> "Agregar al Carrito" (Figma). Respeta estados
    // nativos ("Agregando...", "Sin stock") porque matchea el texto exacto.
    function fixBtnText() {
      var btns = container.querySelectorAll("input.js-addtocart,button.js-addtocart,.js-addtocart");
      [].forEach.call(btns, function (b) {
        if (b.tagName === "INPUT") { if (b.value === "Agregar al carrito") b.value = "Agregar al Carrito"; }
        else if (!b.children.length && (b.textContent || "").trim() === "Agregar al carrito") b.textContent = "Agregar al Carrito";
      });
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
      fixBtnText();
      // Label de precio sin impuestos -> "nacionales" (traduccion, no editable por compose)
      var taxLabel = document.querySelector(
        "#quickshop-modal .price-without-taxes-label"
      );
      if (taxLabel) taxLabel.textContent = "Precio sin impuestos nacionales";
    }

    // el botón se re-renderiza al cambiar de estado (Agregando.../Sin stock);
    // un observer re-aplica el texto. Se setea una sola vez.
    if (!container.__kvBtnObs && "MutationObserver" in window) {
      container.__kvBtnObs = new MutationObserver(fixBtnText);
      container.__kvBtnObs.observe(container, { childList: true, subtree: true, characterData: true });
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
  // Cerrar el adbar (barra de anuncios) con una X inyectada. localStorage
  // recuerda el estado cerrado. El botón se inyecta solo donde corre el script,
  // así no queda una X "muerta" en páginas sin JS.
  function initAdbarClose() {
    var section = document.querySelector(".section-announcement-bar");
    var bar = document.querySelector(".adbar");
    var target = section || bar;
    if (!target || !bar) return false;
    try {
      if (sessionStorage.getItem("topbar_closed") === "true") { target.style.display = "none"; return true; }
    } catch (e) {}
    if (bar.querySelector(".kv-adbar-close")) return false;
    var btn = document.createElement("button");
    btn.className = "kv-adbar-close";
    btn.type = "button";
    btn.setAttribute("aria-label", "Cerrar");
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Slide-up 300ms ease-in (colapsa la barra)
      var h = target.offsetHeight;
      target.style.overflow = "hidden";
      target.style.maxHeight = h + "px";
      void target.offsetHeight; // reflow
      target.style.transition = "max-height 300ms ease-in, opacity 300ms ease-in";
      target.style.maxHeight = "0";
      target.style.opacity = "0";
      setTimeout(function () { target.style.display = "none"; }, 320);
      try { sessionStorage.setItem("topbar_closed", "true"); } catch (e2) {}
    });
    bar.appendChild(btn);
    return false;
  }

  // Carrusel VERTICAL de mensajes del top bar (reemplaza el swiper nativo).
  // Sale hacia arriba y entra desde abajo simultáneamente. 800ms ease-out,
  // pausa 3000ms, loop infinito.
  function initTopbarCarousel() {
    var bar = document.querySelector(".adbar");
    if (!bar || bar.getAttribute("data-kv-topbar")) return;
    var slider = bar.querySelector(".js-adbar-slider, .adbar-slider, .js-adbar-marquee");
    var itemEls = bar.querySelectorAll(".adbar-item");
    if (!itemEls.length) return;
    // Mensajes únicos (el swiper duplica slides en modo loop)
    var seen = {}, msgs = [];
    for (var k = 0; k < itemEls.length; k++) {
      var key = itemEls[k].textContent.replace(/\s+/g, " ").trim();
      if (!key || seen[key]) continue;
      seen[key] = 1;
      msgs.push(itemEls[k].innerHTML);
    }
    if (msgs.length < 2) return; // un solo mensaje: nada que rotar
    bar.setAttribute("data-kv-topbar", "1");

    // Destruir/ocultar el slider nativo
    if (slider) {
      try { if (slider.swiper) slider.swiper.destroy(true, true); } catch (e) {}
      slider.style.display = "none";
    }

    var vp = document.createElement("div");
    vp.className = "kv-topbar";
    var track = document.createElement("div");
    track.className = "kv-topbar-track";
    var all = msgs.concat([msgs[0]]); // duplicado del primero => loop seamless
    all.forEach(function (html) {
      var m = document.createElement("div");
      m.className = "kv-topbar-msg";
      m.innerHTML = html;
      track.appendChild(m);
    });
    vp.appendChild(track);
    bar.insertBefore(vp, bar.firstChild);

    // Altura de UN mensaje (el % en translateY sería relativo al track entero,
    // por eso se mueve en píxeles: 1 mensaje por paso).
    function msgH() {
      return (track.children[0] && track.children[0].getBoundingClientRect().height) ||
             vp.getBoundingClientRect().height || 16;
    }
    var i = 0;
    function step() {
      i++;
      track.style.transition = "transform 800ms ease-out";
      track.style.transform = "translateY(" + (-i * msgH()) + "px)";
    }
    track.addEventListener("transitionend", function () {
      if (i >= msgs.length) { // llegó al duplicado del primero
        track.style.transition = "none";
        i = 0;
        track.style.transform = "translateY(0)";
        void track.offsetHeight; // reflow (evita animar el salto)
      }
      setTimeout(step, 3000); // pausa entre slides
    });
    setTimeout(step, 3000);
  }

  // Header sticky en mobile + al scrollear: se oculta la barra "Buscar
  // productos" y aparece una lupa al lado del menú (inyectada dentro del
  // menu-container para no romper el grid del header).
  function initStickyHeader() {
    var head = document.querySelector(".js-head-main");
    if (!head) return;
    var menu = document.querySelector(".js-head-main .menu-container");
    var trigger = document.querySelector(".js-head-main .search-trigger");
    if (menu && trigger && !menu.querySelector(".kv-scroll-search")) {
      var b = document.createElement("button");
      b.className = "kv-scroll-search";
      b.type = "button";
      b.setAttribute("aria-label", "Buscar");
      b.addEventListener("click", function (e) { e.preventDefault(); trigger.click(); });
      menu.appendChild(b);
    }
    // Spacer para evitar el salto cuando el header pasa a position:fixed.
    var spacer = document.createElement("div");
    spacer.className = "kv-head-spacer";
    spacer.style.display = "none";
    head.parentNode.insertBefore(spacer, head.nextSibling);

    var adbar = document.querySelector(".section-announcement-bar, .adbar");
    var searchC = document.querySelector(".js-head-main .search-container");
    var isMobile = function () { return window.matchMedia("(max-width:767px)").matches; };
    var ticking = false;
    function upd() {
      ticking = false;
      if (!isMobile()) { // el sticky custom es solo mobile
        head.classList.remove("kv-scrolled");
        spacer.style.display = "none";
        return;
      }
      var threshold = (adbar && adbar.offsetParent !== null) ? adbar.offsetHeight : 0;
      var y = window.pageYOffset || document.documentElement.scrollTop;
      if (y > threshold) {
        if (!head.classList.contains("kv-scrolled")) {
          var full = head.offsetHeight;                    // alto CON la barra de búsqueda
          var searchH = searchC ? searchC.offsetHeight : 0;
          head.classList.add("kv-scrolled");               // fijo + arranca el colapso (CSS)
          spacer.style.transition = "none";
          spacer.style.height = full + "px";               // sin salto: ocupa el alto previo
          spacer.style.display = "block";
          void spacer.offsetHeight;                        // reflow
          spacer.style.transition = "height .3s ease";
          spacer.style.height = (full - searchH) + "px";   // colapsa suave junto con la búsqueda
        }
      } else if (head.classList.contains("kv-scrolled")) {
        head.classList.remove("kv-scrolled");
        spacer.style.transition = "none";
        spacer.style.display = "none";
      }
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(upd); }
    }, { passive: true });
    window.addEventListener("resize", upd, { passive: true });
    upd();
  }

  /* Segundo bloque de banners (facilitadores) en mobile: carrusel con "peek"
     de los vecinos (node Figma 3573-35012). El theme lo inicializa como slider
     slidesPerView:1 (ancho completo); lo reconfiguramos a slidesPerView:'auto'
     + centeredSlides + loop para que el banner de 285px quede centrado y asomen
     los laterales. Solo mobile: en desktop la seccion es grid (sin swiper). */
  function initFacilitatorsSlider() {
    var container = document.querySelector("#ns-section-facilitators .js-banners-slider");
    if (!container) return;
    var wrapper = container.closest(".js-banners-slider-container");
    var pag = wrapper ? wrapper.querySelector(".js-swiper-banners-pagination") : null;
    var prevEl = wrapper ? wrapper.querySelector(".js-swiper-banners-prev") : null;
    var nextEl = wrapper ? wrapper.querySelector(".js-swiper-banners-next") : null;
    var mode = null; // 'mobile' | 'desktop'

    function isMobile() { return window.innerWidth < 768; }

    // Reconfiguramos el swiper nativo (que viene con loop:true) SIN loop, en ambos
    // breakpoints. Mobile: peek auto+centered. Desktop: 3 por vista + flechas nativas.
    function apply() {
      if (typeof Swiper === "undefined") return;
      var target = isMobile() ? "mobile" : "desktop";
      if (mode === target && container.swiper) return; // ya en el modo correcto
      if (container.swiper) { try { container.swiper.destroy(true, true); } catch (e) {} }
      /* global Swiper */
      var cfg = isMobile()
        ? {
            slidesPerView: "auto",
            centeredSlides: true,
            spaceBetween: 16,
            loop: false,
            pagination: pag ? { el: pag, clickable: true } : false,
          }
        : {
            slidesPerView: 3,
            spaceBetween: 16,
            loop: false,
            watchOverflow: true,
            navigation: prevEl && nextEl ? { prevEl: prevEl, nextEl: nextEl } : false,
          };
      new Swiper(container, cfg);
      mode = target;
    }

    // Esperar a que el theme cree su swiper (setTimeout 0) y reconfigurar.
    var tries = 0;
    (function wait() {
      if (container.swiper || tries > 30) { apply(); return; }
      tries++;
      setTimeout(wait, 50);
    })();

    window.addEventListener("resize", apply, { passive: true });
  }

  /* "Nueva Coleccion" con tabs Hombre/Mujer — GENERICO. Cada seccion product-list
     con tabs lleva en su header un marcador data-kv-role="hombre|mujer". Empareja
     cada seccion Mujer con la seccion Hombre inmediatamente anterior (orden del DOM),
     asi soporta N bloques duplicados desde el admin. Al tocar un tab muestra su
     seccion del par y oculta la otra; reconfigura peek (slidesPerView:'auto',
     card 283px por CSS) en mobile, preservando el 4-up de desktop (node 959-19494). */
  function initNewCollectionTabs() {
    function isMobile() { return window.innerWidth < 768; }
    function swiperEl(section) { return section ? section.querySelector(".js-products-list-swiper") : null; }
    function roleOf(section) { var el = section.querySelector("[data-kv-role]"); return el ? el.getAttribute("data-kv-role") : null; }

    /* Reconfigura el swiper de una seccion a peek en mobile; si ya esta hecho, solo update() */
    function peek(section) {
      if (!section) return;
      var container = swiperEl(section);
      if (!container) return;
      if (container._kvPeek) { if (container.swiper) container.swiper.update(); return; }
      if (!isMobile()) { if (container.swiper) container.swiper.update(); return; }
      if (typeof Swiper === "undefined") return;
      var parent = container.closest(".js-products-list-slider-container");
      var wrapper = container.querySelector(".js-swiper-products-slider");
      var cols = wrapper && wrapper.dataset.desktopColumns ? (parseInt(wrapper.dataset.desktopColumns, 10) || 4) : 4;
      var slideCount = container.querySelectorAll(".swiper-slide").length;
      if (container.swiper) { try { container.swiper.destroy(true, true); } catch (e) {} }
      /* global Swiper */
      new Swiper(container, {
        slidesPerView: "auto",
        spaceBetween: 16,
        loop: slideCount > cols,
        watchOverflow: true,
        navigation: parent ? {
          nextEl: parent.querySelector(".js-swiper-products-list-next"),
          prevEl: parent.querySelector(".js-swiper-products-list-prev")
        } : false,
        pagination: false,
        breakpoints: { 768: { slidesPerView: cols, slidesPerGroup: cols } }
      });
      container._kvPeek = true;
    }

    // Armar pares por orden del DOM: cada Mujer con el Hombre anterior mas cercano.
    var sections = Array.prototype.slice.call(document.querySelectorAll('[id^="ns-section-"]'))
      .filter(function (s) { return s.querySelector("[data-kv-role]"); });
    var pairs = [], lastHombre = null;
    sections.forEach(function (s) {
      var r = roleOf(s);
      if (r === "hombre") { lastHombre = s; }
      else if (r === "mujer" && lastHombre) { pairs.push({ hombre: lastHombre, mujer: s }); lastHombre = null; }
    });
    if (!pairs.length) return;

    function show(pair, which) {
      var showEl = which === "mujer" ? pair.mujer : pair.hombre;
      var hideEl = which === "mujer" ? pair.hombre : pair.mujer;
      hideEl.style.display = "none";
      // "block" explicito: la Mujer tiene display:none por CSS y "" no lo pisa (el inline si)
      showEl.style.display = "block";
      peek(showEl);
      var c = swiperEl(showEl);
      if (c && c.swiper) { c.swiper.update(); }
    }

    pairs.forEach(function (pair) {
      // Mujer oculta desde JS tambien (fallback si el navegador no soporta :has)
      pair.mujer.style.display = "none";
      [pair.hombre, pair.mujer].forEach(function (sec) {
        sec.querySelectorAll("[data-kv-tab]").forEach(function (el) {
          el.style.cursor = "pointer";
          el.addEventListener("click", function (e) { e.preventDefault(); show(pair, el.getAttribute("data-kv-tab")); });
        });
      });
      // Init: peek de la seccion visible (Hombre) cuando el theme cree su swiper
      var tries = 0;
      (function wait() {
        var c = swiperEl(pair.hombre);
        if ((c && c.swiper) || tries > 30) { peek(pair.hombre); return; }
        tries++;
        setTimeout(wait, 50);
      })();
    });

    window.addEventListener("resize", function () {
      pairs.forEach(function (pair) {
        var visible = (getComputedStyle(pair.mujer).display !== "none") ? pair.mujer : pair.hombre;
        peek(visible);
      });
    }, { passive: true });
  }

  /* Footer newsletter: textos del Figma. Las translations requieren fork, asi que
     por ahora los seteamos por JS (solo aplica en las 5 paginas donde carga este script). */
  function initFooterText() {
    var input = document.querySelector(".footer-content .newsletter-form-input");
    if (input) { input.placeholder = "Ingresá tu email"; input.setAttribute("aria-label", "Ingresá tu email"); }
    var btn = document.querySelector(".footer-content .newsletter-form-button");
    if (btn) { btn.value = "Suscribirme"; }
  }

  /* ------------------------------------------------------------------ */
  /* Busqueda SIN RESULTADOS -> pagina de error tipo hero (Figma 3572-32152).*/
  /* Solo en template-search cuando NO hay resultados (existe la sugerencia). */
  /* Oculta el contenido nativo (header + grid + destacados) e inyecta el hero.*/
  /* Foto de fondo + titulo + subtitulo + 2 botones (HTML real). La FOTO la     */
  /* sube el cliente (img/search-error.jpg); mientras, fallback #2b2b2b.        */
  /* ------------------------------------------------------------------ */
  function initSearchEmpty() {
    if (document.body.getAttribute("data-kv-search-empty")) return;
    if (!/\btemplate-search\b/.test(document.body.className)) return;
    // "sin resultados" = el nativo renderiza la sugerencia de busqueda
    if (!document.querySelector(".products-grid-search-suggestion")) return;
    document.body.setAttribute("data-kv-search-empty", "1");
    document.body.classList.add("kv-search-empty-on");
    var hero = document.createElement("section");
    hero.className = "kv-search-empty";
    hero.innerHTML =
      '<div class="kv-search-empty-inner">' +
      '<h1 class="kv-search-empty-title">No hay resultados para tu búsqueda</h1>' +
      '<p class="kv-search-empty-text">La página que buscas no fue encontrada. Por favor, volvé a la página principal o visita nuestra sección de Ayuda.</p>' +
      '<div class="kv-search-empty-btns">' +
      '<a class="kv-search-btn-help" href="#">Sección de Ayuda</a>' +
      '<a class="kv-search-btn-home" href="/">Regresar al Inicio</a>' +
      "</div></div>";
    var main = document.getElementById("MainContent") || document.body;
    main.insertBefore(hero, main.firstChild);
  }

  /* ------------------------------------------------------------------ */
  /* Banners: animacion de entrada del contenido (spec 03).              */
  /* ------------------------------------------------------------------ */
  var bannerPending = [], bannerBound = false, bannerFirstDone = false;
  function initBannerReveal() {
    /* Anima los bloques de texto (.media-content) de los banners. El 1er (hero)
       revela al cargar con delay; el resto SOLO cuando entra al viewport DESPUES
       de haber estado por debajo. Ese gate "wasBelow" evita el falso positivo del
       load: al cargar, las imagenes lazy de arriba colapsan el layout y todos los
       banners caen en el viewport inicial; como aun no estuvieron "por debajo",
       no se revelan. Un barrido periodico actualiza wasBelow a medida que cargan
       las imagenes (el layout crece y los banners bajan). Re-ejecutable. */
    var secs = document.querySelectorAll(
      ".section-banners, .js-slideshow-container, .section-hero, .section-video"
    );
    for (var i = 0; i < secs.length; i++) {
      (function (sec) {
        if (sec._kvReveal) return;
        var contents = sec.querySelectorAll(".media-content");
        var hasText = false;
        for (var k = 0; k < contents.length; k++) {
          if ((contents[k].textContent || "").trim()) { hasText = true; break; }
        }
        // Solo anima los BLOQUES DE TEXTO. Banners solo-imagen quedan estaticos.
        if (!hasText) return;
        var targets = contents;
        if (!targets.length) return;
        sec._kvReveal = true;
        for (var j = 0; j < targets.length; j++) targets[j].classList.add("kv-reveal");
        var reveal = function () {
          for (var m = 0; m < targets.length; m++) targets[m].classList.add("kv-revealed");
        };
        if (!bannerFirstDone) {
          bannerFirstDone = true;
          setTimeout(reveal, 1600); // hero: revela al cargar (visible de entrada)
        } else {
          bannerPending.push({ sec: sec, reveal: reveal, wasBelow: false });
        }
      })(secs[i]);
    }

    if (bannerBound) return;
    bannerBound = true;
    function sweep() {
      var vh = window.innerHeight || document.documentElement.clientHeight || 800;
      for (var i = bannerPending.length - 1; i >= 0; i--) {
        var p = bannerPending[i];
        var r = p.sec.getBoundingClientRect();
        if (r.top >= vh) p.wasBelow = true; // estuvo debajo del viewport
        // Revela cuando el banner ENTRÓ en un 95%: (vh - r.top) = cuánto del banner ya
        // subió dentro del viewport desde abajo; se compara contra el 95% de su alto
        // (o del viewport si el banner es más alto). Para banners de alto normal esto
        // equivale a que su parte inferior entre al viewport. Antes disparaba al 85%
        // del TOP -> muy temprano, la animación pasaba antes de llegar a verla.
        var H = r.height || 1;
        if (p.wasBelow && r.bottom > 40 && (vh - r.top) >= 0.95 * Math.min(H, vh)) {
          p.reveal();
          bannerPending.splice(i, 1);
        }
      }
    }
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { sweep(); ticking = false; });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // barridos periodicos (8s): actualizan wasBelow mientras cargan las imagenes
    // y crece el layout, sin depender de un scroll.
    var t = 0, iv = setInterval(function () { sweep(); if (++t > 20 || !bannerPending.length) clearInterval(iv); }, 400);
  }

  /* ------------------------------------------------------------------ */
  /* SEO headings: el heading-block del theme siempre es <div> (nota SEO  */
  /* del theme). Lo convertimos al tag semantico segun el Figma 3665-15447:*/
  /* hero -> H1 (solo el 1ro), titulos de banner -> H2, titulos de         */
  /* seccion/carrusel -> H3. Conserva clases -> mismos estilos.            */
  /* ------------------------------------------------------------------ */
  function swapTag(el, tag) {
    if (!el || el.tagName.toLowerCase() === tag) return el;
    var n = document.createElement(tag);
    for (var i = 0; i < el.attributes.length; i++)
      n.setAttribute(el.attributes[i].name, el.attributes[i].value);
    n.innerHTML = el.innerHTML;
    el.parentNode.replaceChild(n, el);
    return n;
  }
  function initSeoHeadings() {
    // Hero: SOLO el primer titulo (no duplicado) -> H1 (un unico H1 por pagina)
    var heroTitles = [].slice.call(
      document.querySelectorAll(
        "#ns-section-hero_slideshow .media-content .heading-block"
      )
    ).filter(function (h) { return !h.closest(".swiper-slide-duplicate"); });
    if (heroTitles[0]) swapTag(heroTitles[0], "h1");
    // Titulos dentro de banners (fuera del hero) -> H2
    var bannerTitles = document.querySelectorAll(".media-content .heading-block");
    for (var i = 0; i < bannerTitles.length; i++) {
      var h = bannerTitles[i];
      if (h.closest("#ns-section-hero_slideshow")) continue;
      if (h.closest(".swiper-slide-duplicate")) continue;
      swapTag(h, "h2");
    }
    // Titulos de seccion/carrusel (fuera de media-content y de cards) -> H3
    var secTitles = document.querySelectorAll(".heading-block");
    for (var j = 0; j < secTitles.length; j++) {
      var s = secTitles[j];
      if (
        s.closest(".media-content") ||
        s.closest(".product-item") ||
        s.closest(".swiper-slide-duplicate")
      )
        continue;
      swapTag(s, "h3");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Buscador: panel que baja desde arriba (HTML+CSS ya existen en el     */
  /* home). Cableamos abrir (click en el icono del header) / cerrar       */
  /* (X o Escape) / foco automatico / scroll-lock.                        */
  /* ------------------------------------------------------------------ */
  var SEARCH_PANEL_HTML =
    '<div class="f2tn-search-ov"><div class="f2tn-search-panel">' +
    '<button type="button" class="f2tn-search-close" aria-label="Cerrar"></button>' +
    '<div class="f2tn-search-inner">' +
    '<form class="f2tn-search-form" action="/search" method="get" role="search">' +
    '<span class="f2tn-search-ico" aria-hidden="true"></span>' +
    '<input type="search" name="q" placeholder="Buscar" aria-label="Buscar" autocomplete="off"></form>' +
    '<div class="f2tn-search-cols"><div class="f2tn-col-links"><h3 class="f2tn-h">Más buscados</h3>' +
    '<ul class="f2tn-links">' +
    '<li><a href="/search?q=Boxers">Boxers</a></li><li><a href="/search?q=Calzado">Calzado</a></li>' +
    '<li><a href="/search?q=Remeras">Remeras</a></li><li><a href="/search?q=Chombas">Chombas</a></li>' +
    '<li><a href="/search?q=Camisas">Camisas</a></li><li><a href="/search?q=Jeans">Jeans</a></li></ul></div>' +
    '<div class="f2tn-col-banners"><h3 class="f2tn-h">Te puede interesar</h3><div class="f2tn-banners">' +
    '<a class="f2tn-bcard" href="/search?q=Mochilas"><span class="f2tn-bimg"></span><span class="f2tn-blabel">Mochilas</span></a>' +
    '<a class="f2tn-bcard" href="/search?q=Camperas"><span class="f2tn-bimg"></span><span class="f2tn-blabel">Camperas</span></a>' +
    '<a class="f2tn-bcard" href="/search?q=Buzos"><span class="f2tn-bimg"></span><span class="f2tn-blabel">Buzos</span></a>' +
    '</div></div></div></div></div></div>';

  function initSearchPanel() {
    var panel = document.querySelector(".f2tn-search-panel");
    if (!panel) {
      // pagina sin panel (no-home): lo inyectamos (el CSS del css_code es global)
      var wrap = document.createElement("div");
      wrap.innerHTML = SEARCH_PANEL_HTML;
      document.body.appendChild(wrap.firstChild);
      panel = document.querySelector(".f2tn-search-panel");
    }
    if (!panel) return;
    var ov = panel.parentElement;
    if (!ov) return;
    ov.classList.add("f2tn-search-ov");
    var input = panel.querySelector('input[type="search"], input[name="q"]');
    var closeBtn = panel.querySelector(".f2tn-search-close");
    // ancho de la scrollbar → compensamos con padding-right para que el
    // contenido (y el header fixed) NO salte horizontal al bloquear/soltar el scroll
    function scrollbarW() {
      return window.innerWidth - document.documentElement.clientWidth;
    }
    var headerEl = document.querySelector(".js-header, .header, header");
    function open() {
      ov.classList.add("f2tn-open");
      var sw = scrollbarW();
      document.body.style.overflow = "hidden";
      if (sw > 0) {
        document.body.style.paddingRight = sw + "px";
        if (headerEl) headerEl.style.paddingRight = sw + "px";
      }
      setTimeout(function () { if (input) input.focus(); }, 120);
    }
    function close() {
      ov.classList.remove("f2tn-open");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
      if (headerEl) headerEl.style.paddingRight = "";
    }
    // Trigger del header (capture + stop para bloquear el buscador nativo)
    var trigs = document.querySelectorAll(
      ".js-search-trigger, .search-trigger"
    );
    for (var i = 0; i < trigs.length; i++) {
      trigs[i].addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          open();
        },
        true
      );
    }
    if (closeBtn) closeBtn.addEventListener("click", function (e) { e.preventDefault(); close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("f2tn-open")) close();
    });

    /* Resultados en vivo: al escribir, fetch a /search y reemplaza el contenido
       por una lista (thumbnail + nombre) + "Ver todos". Sin resultados -> vacio. */
    var cols = panel.querySelector(".f2tn-search-cols"); // contenido default (mas buscados + banners)
    var results = document.createElement("div");
    results.className = "f2tn-results";
    results.style.display = "none";
    if (cols) cols.parentNode.insertBefore(results, cols.nextSibling);
    function esc(s) {
      return String(s).replace(/[<>&"]/g, function (c) {
        return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c];
      });
    }
    function resetDefault() {
      results.style.display = "none";
      results.innerHTML = "";
      if (cols) cols.style.removeProperty("display"); // vuelve al display del CSS
    }
    function doSearch(q) {
      fetch("/search?q=" + encodeURIComponent(q))
        .then(function (r) { return r.text(); })
        .then(function (html) {
          if (input.value.trim() !== q) return; // el query cambio, descartar
          var doc = new DOMParser().parseFromString(html, "text/html");
          var items = doc.querySelectorAll(".js-item-product");
          // TN muestra productos de fallback aunque no haya match -> el "sin resultados"
          // se detecta por el titulo "No encontramos nada para ...".
          var hdr = doc.querySelector(".page-header-title");
          var noResults = hdr ? /no\s+encontr/i.test(hdr.textContent || "") : false;
          // !important para ganarle al display:flex!important del CSS del layout
          if (cols) cols.style.setProperty("display", "none", "important");
          results.style.display = "";
          if (noResults || !items.length) { results.innerHTML = ""; return; } // estado vacio
          var out = "";
          for (var i = 0; i < Math.min(items.length, 5); i++) {
            var it = items[i];
            var a = it.querySelector("a[href]");
            var url = a ? a.getAttribute("href") : "#";
            var n = it.querySelector(".js-item-name, .product-item-name");
            var name = n ? n.textContent.trim() : "";
            var img = it.querySelector("img");
            var src = "";
            if (img) {
              // en el HTML crudo la URL real esta en data-srcset/data-src (lazy);
              // el srcset y el src son placeholders vacios/base64.
              // Elegimos ~240w del srcset: la 1ra entrada es 50w -> pixelada en el
              // box 48x60 (peor en retina). 240w es nitido y liviano.
              var pickSrc = function (ss, target) {
                if (!ss) return "";
                var best = "", bestW = 0, big = "", bigW = 0;
                ss.split(",").forEach(function (part) {
                  var seg = part.trim().split(/\s+/);
                  var u = seg[0]; if (!u) return;
                  var w = parseInt(seg[1], 10) || 0;
                  if (w > bigW) { big = u; bigW = w; } // mas grande (fallback)
                  if (w >= target && (bestW === 0 || w < bestW)) { best = u; bestW = w; } // menor >= target
                });
                return best || big;
              };
              src =
                pickSrc(img.getAttribute("data-srcset"), 240) ||
                img.getAttribute("data-src") ||
                pickSrc(img.getAttribute("srcset"), 240) ||
                "";
              var raw = img.getAttribute("src") || "";
              if (!src && raw.indexOf("data:") !== 0) src = raw;
              if (src.indexOf("//") === 0) src = "https:" + src;
            }
            out +=
              '<a class="f2tn-result" href="' + url + '">' +
              '<span class="f2tn-result-img" style="background-image:url(\'' + src + "')\"></span>" +
              '<span class="f2tn-result-name">' + esc(name) + "</span></a>";
          }
          out += '<a class="f2tn-result-all" href="/search?q=' + encodeURIComponent(q) + '">Ver todos los resultados</a>';
          results.innerHTML = out;
        })
        .catch(function () {});
    }
    var deb;
    input.addEventListener("input", function () {
      clearTimeout(deb);
      var q = input.value.trim();
      if (q.length < 2) { resetDefault(); return; }
      deb = setTimeout(function () { doSearch(q); }, 350);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Modal de suscripción (#promotional-modal newsletter)                */
  /* Inyecta Nombre (mobile) + checkboxes de intereses funcionales, y    */
  /* maneja el estado de éxito (banner + mensaje, sin form). Figma        */
  /* desktop 1981-25825 / mobile 1982-27317 / éxito 1981-26151.          */
  /* ------------------------------------------------------------------ */
  function initPromoModal() {
    var modal = document.getElementById("promotional-modal");
    if (!modal || modal.getAttribute("data-kv-sub") === "1") return;
    var form = modal.querySelector(".js-newsletter-form-ajax, .newsletter-form");
    if (!form) return; // popup sin newsletter (modo CTA) -> no tocamos
    modal.setAttribute("data-kv-sub", "1");

    // Honeypot anti-spam: el theme deja action="/winnie-pooh" (URL trampa) y confía
    // en que el handler AJAX haga preventDefault. Si el ajax NO intercepta, el submit
    // nativo cae en la trampa y te redirige a /winnie-pooh. Blindaje: al enviar, si la
    // action sigue apuntando a la trampa, la limpiamos para postear a la página actual
    // (igual que hace el theme para forms NO-ajax) y el server procesa la suscripción.
    form.addEventListener("submit", function () {
      if ((form.getAttribute("action") || "").indexOf("winnie-pooh") !== -1) {
        form.setAttribute("action", "");
      }
    });

    var wrapper = form.querySelector(".newsletter-form-wrapper") || form;
    var emailInput = wrapper.querySelector('input[name="email"]');
    var button = wrapper.querySelector('button[type="submit"], .newsletter-form-button');
    var hiddenName = form.querySelector('input[name="name"]');
    var hiddenMsg = form.querySelector('input[name="message"]');
    var baseMsg = (hiddenMsg && hiddenMsg.value) || "Pedido de inscripción a newsletter";
    if (!emailInput || !button) return;

    function field(labelText, input) {
      var f = document.createElement("div");
      f.className = "kv-sub-field";
      var l = document.createElement("label");
      l.className = "kv-sub-label";
      l.innerHTML = labelText + ' <span>*</span>';
      if (input.id) l.setAttribute("for", input.id);
      f.appendChild(l);
      f.appendChild(input);
      return f;
    }

    // Email: envolver el input nativo con su label (placeholder exacto Figma)
    emailInput.placeholder = "Ingresa tu email";
    emailInput.setAttribute("aria-label", "Email");
    var emailField = field("Email", emailInput);
    emailField.classList.add("kv-sub-field-email");

    // Nombre (visible solo en mobile por CSS) -> escribe en el hidden name
    var nombreInput = document.createElement("input");
    nombreInput.type = "text";
    nombreInput.className = "kv-sub-input kv-sub-nombre";
    nombreInput.placeholder = "Ingresa tu nombre";
    nombreInput.setAttribute("aria-label", "Nombre");
    var nombreField = field("Nombre", nombreInput);
    nombreField.classList.add("kv-sub-field-nombre");
    nombreInput.addEventListener("input", function () {
      if (hiddenName) hiddenName.value = nombreInput.value.trim() || "Sin nombre";
    });

    // Checkboxes de intereses -> se guardan en el hidden message
    var interests = [
      { v: "Hombre", t: "HOMBRE" },
      { v: "Mujer", t: "MUJER" },
      { v: "Teens & Kids", t: "TEENS & KIDS" },
    ];
    var box = document.createElement("div");
    box.className = "kv-sub-interests";
    var boxes = [];
    interests.forEach(function (it) {
      var lab = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = it.v;
      boxes.push(cb);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(it.t));
      box.appendChild(lab);
    });
    function syncMsg() {
      var sel = boxes.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      if (hiddenMsg) hiddenMsg.value = sel.length ? baseMsg + " — Intereses: " + sel.join(", ") : baseMsg;
    }
    boxes.forEach(function (c) { c.addEventListener("change", syncMsg); });

    // Ordenar dentro del wrapper: Nombre, Email, Intereses, Botón
    wrapper.insertBefore(nombreField, button);
    wrapper.insertBefore(emailField, button);
    wrapper.insertBefore(box, button);

    // Botón deshabilitado hasta completar nombre (si visible) + email (spec 07-B/M06-B)
    function refreshBtn() {
      var emailOk = emailInput.value.trim().length > 0;
      var nombreVisible = getComputedStyle(nombreField).display !== "none";
      var nombreOk = !nombreVisible || nombreInput.value.trim().length > 0;
      var ok = emailOk && nombreOk;
      button.disabled = !ok;
      button.classList.toggle("kv-sub-disabled", !ok);
    }
    emailInput.addEventListener("input", refreshBtn);
    nombreInput.addEventListener("input", refreshBtn);
    window.addEventListener("resize", refreshBtn);
    refreshBtn();

    // Mensaje de éxito (banner + texto centrado, reemplaza el form)
    var content = modal.querySelector(".promotional-modal-content");
    if (content && !content.querySelector(".kv-sub-successbox")) {
      var sb = document.createElement("div");
      sb.className = "kv-sub-successbox";
      sb.innerHTML =
        '<p class="kv-sub-success-title">¡Ya te suscribiste a nuestro newsletter!</p>' +
        '<p class="kv-sub-success-text">Revisá tu casilla de email y enterate de todas las novedades.</p>';
      content.appendChild(sb);
    }
    // Marca el newsletter como cerrado/enviado en la sesión → el modal de promos
    // respeta la prioridad del newsletter (spec 07-C/M06-C).
    function markNewsletterDone() { try { sessionStorage.setItem("kv-newsletter-done", "1"); } catch (e) {} }

    var successAlert = form.querySelector(".js-newsletter-success-alert");
    if (successAlert) {
      // El theme muestra el alert seteando display:block INLINE. No podemos usar
      // getComputedStyle porque el CSS lo tapa con !important (siempre "none"):
      // detectamos por el style inline que togglea el theme.
      var show = function () {
        var vis = successAlert.style.display !== "none" && successAlert.style.display !== "";
        modal.classList.toggle("kv-sub-success", vis);
        if (vis) markNewsletterDone();
      };
      new MutationObserver(show).observe(successAlert, { attributes: true, attributeFilter: ["style", "class"] });
      show();
    }
    // cierre por ×, overlay o Escape → el modal pierde .modal-show
    var closeBtn = modal.querySelector(".modal-close");
    if (closeBtn) closeBtn.addEventListener("click", markNewsletterDone);
    var wasShown = false;
    new MutationObserver(function () {
      if (modal.classList.contains("modal-show")) wasShown = true;
      else if (wasShown) markNewsletterDone();
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  }

  /* ------------------------------------------------------------------ */
  /* Modal de PROMOCIONES (custom, .f2tn-offers-ov) — home. Figma        */
  /* 3004-25747 / 2828-30293. Banner+texto+link/CTA editables en el      */
  /* bloque HTML. Control por atributos del ov:                          */
  /*   data-active="true|false"  -> encender/apagar                       */
  /*   data-from / data-to (ISO)  -> ventana opcional (workaround schedule)*/
  /* Exclusión mutua: si está activo, oculta la suscripción nativa        */
  /* (clase html.kv-offers-active). Cap 1/sesión.                        */
  /* ------------------------------------------------------------------ */
  function initOffersModal() {
    var ov = document.querySelector(".f2tn-offers-ov");
    if (!ov || ov.getAttribute("data-kv-off") === "1") return;
    ov.setAttribute("data-kv-off", "1");
    if (ov.getAttribute("data-active") !== "true") return; // apagado -> no toca la suscripción

    // ventana de fechas opcional (hora local; migrable a hora de servidor)
    var from = ov.getAttribute("data-from");
    var to = ov.getAttribute("data-to");
    var now = Date.now();
    function ms(s) { var t = s ? Date.parse(s) : NaN; return isNaN(t) ? null : t; }
    var f = ms(from), t = ms(to);
    if ((f !== null && now < f) || (t !== null && now > t)) return; // fuera de ventana

    // cap 1/sesión: una vez cerrado no vuelve a aparecer
    var seen = false;
    try { seen = sessionStorage.getItem("kv-offers-seen") === "1"; } catch (e) {}
    if (seen) return;

    // Prioridad del newsletter: la promo NO aparece si el newsletter sigue activo
    // (habilitado y no cerrado/enviado en la sesión).
    function newsletterActive() {
      if (!document.getElementById("promotional-modal")) return false; // newsletter no habilitado
      var done = false;
      try { done = sessionStorage.getItem("kv-newsletter-done") === "1"; } catch (e) {}
      return !done;
    }

    function close() {
      ov.classList.remove("f2tn-open");
      document.documentElement.classList.remove("f2tn-lock");
    }
    var closeBtn = ov.querySelector(".f2tn-offers-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("f2tn-open")) close();
    });

    // Automático 5s después de entrar al sitio
    setTimeout(function () {
      if (newsletterActive()) return; // el newsletter tiene prioridad → no mostramos
      ov.classList.add("f2tn-open");
      document.documentElement.classList.add("f2tn-lock");
      try { sessionStorage.setItem("kv-offers-seen", "1"); } catch (e) {}
    }, 5000);
  }

  /* ------------------------------------------------------------------ */
  /* Menú: morph ícono hamburguesa → X. Togglea html.kv-menu-open cuando  */
  /* el drawer #nav-hamburger se abre/cierra (el CSS hace el cross-fade). */
  /* ------------------------------------------------------------------ */
  function initMenuIcon() {
    var ham = document.getElementById("nav-hamburger");
    if (!ham) return;
    var root = document.documentElement;
    var sync = function () {
      var open = ham.classList.contains("modal-visible") || ham.classList.contains("modal-show");
      root.classList.toggle("kv-menu-open", open);
    };
    new MutationObserver(sync).observe(ham, { attributes: true, attributeFilter: ["class"] });
    sync();
  }

  /* ------------------------------------------------------------------ */
  /* Menú: abrir Nivel 2 por CLICK (desktop). El click nativo abre el     */
  /* sub-modal reparentándolo al body (rompe el side-by-side), así que lo  */
  /* bloqueamos y togglamos .kv-l2-open en el padre (el CSS lo muestra al  */
  /* lado con fade). En mobile se deja el drill-down nativo (stack).       */
  /* ------------------------------------------------------------------ */
  function initMenuClickNav() {
    var ham = document.getElementById("nav-hamburger");
    if (!ham || ham.getAttribute("data-kv-nav") === "1") return;
    ham.setAttribute("data-kv-nav", "1");

    ham.addEventListener("click", function (e) {
      if (window.innerWidth < 768) return; // mobile: drill-down nativo
      var link = e.target.closest && e.target.closest(".nav-list-link");
      if (!link) return;
      var item = link.parentElement;
      if (!item || !item.classList.contains("item-with-subitems")) return;
      // solo Nivel 1 (hijo directo de .nav-list); los subitems de Panel 2 no
      if (!item.parentElement || !item.parentElement.classList.contains("nav-list")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var wasOpen = item.classList.contains("kv-l2-open");
      ham.querySelectorAll(".nav-list > .nav-item.item-with-subitems.kv-l2-open").forEach(function (o) {
        o.classList.remove("kv-l2-open");
      });
      if (!wasOpen) item.classList.add("kv-l2-open");
    }, true); // capture: corre antes que el handler nativo

    // Al cerrar el drawer, resetear el estado de Nivel 2
    new MutationObserver(function () {
      if (!ham.classList.contains("modal-visible") && !ham.classList.contains("modal-show")) {
        ham.querySelectorAll(".nav-list > .nav-item.item-with-subitems.kv-l2-open").forEach(function (o) {
          o.classList.remove("kv-l2-open");
        });
      }
    }).observe(ham, { attributes: true, attributeFilter: ["class"] });
  }

  /* Menú Panel 2/3: el nativo pone "Ver todo en {categoría}" (traducción no editable
     en compose). Lo acortamos a "Ver todo" (Figma). */
  function initMenuVerTodo() {
    var ham = document.getElementById("nav-hamburger");
    if (!ham) return;
    ham.querySelectorAll(".nav-hamburger-body .nav-item > .nav-list-link").forEach(function (a) {
      if (/^\s*ver todo en /i.test(a.textContent || "")) a.textContent = "Ver todo";
    });
  }

  /* Menú mobile: inyecta el logo centrado en el header del drawer (Figma 959-19822).
     Se oculta en desktop por CSS. La X queda a la derecha. */
  function initMobileMenuLogo() {
    var ham = document.getElementById("nav-hamburger");
    if (!ham) return;
    var header = ham.querySelector(".modal-header");
    if (!header || header.querySelector(".kv-menu-logo")) return;
    var close = header.querySelector(".modal-close");
    var logo = document.createElement("a");
    logo.className = "kv-menu-logo";
    logo.href = "/";
    logo.setAttribute("aria-label", "Kevingston");
    var siteImg = document.querySelector(".js-head-main .logo-img-container img, .js-head-main .logo img");
    var siteTxt = document.querySelector(".js-head-main .logo-text");
    if (siteImg && siteImg.getAttribute("src")) {
      var im = document.createElement("img");
      im.src = siteImg.getAttribute("src");
      im.alt = "Kevingston";
      logo.appendChild(im);
    } else if (siteTxt) {
      logo.textContent = (siteTxt.textContent || "KEVINGSTON").trim();
    } else {
      logo.textContent = "KEVINGSTON";
    }
    var spacer = document.createElement("span");
    spacer.className = "kv-menu-hspacer";
    header.insertBefore(spacer, header.firstChild);
    if (close) header.insertBefore(logo, close); else header.appendChild(logo);
  }

  /* ------------------------------------------------------------------ */
  /* PDP — bloque 2: SKU a 8 dígitos (Figma). El nativo muestra el SKU    */
  /* completo de la variante; mostramos solo los primeros 8 chars.        */
  /* ------------------------------------------------------------------ */
  function initPdp() {
    var skuEl = document.querySelector(".js-product-sku");
    if (!skuEl) return;
    function trunc() {
      var cur = (skuEl.textContent || "").trim();
      var raw = cur.replace(/[^a-z0-9]/gi, "");
      if (raw.length <= 8) return; // ya corto → no tocar (evita loop)
      skuEl.setAttribute("data-kv-full", cur);
      skuEl.textContent = raw.slice(0, 8);
    }
    trunc();
    // el SKU se re-renderiza al cambiar de variante → re-truncar
    new MutationObserver(function () { trunc(); }).observe(skuEl, { childList: true, characterData: true, subtree: true });

    // Reordenar: el nativo pone "Precio sin impuestos" arriba de las cuotas;
    // el Figma lo quiere DEBAJO (cuotas → precio sin impuestos).
    var inst = document.querySelector(".js-max-installments-container");
    var noTax = document.querySelector(".js-price-without-taxes-container,.price-without-taxes-container");
    if (inst && noTax && inst.parentNode && noTax.compareDocumentPosition(inst) & Node.DOCUMENT_POSITION_FOLLOWING) {
      inst.parentNode.insertBefore(noTax, inst.nextSibling);
    }

    // "Precio sin impuestos" → "Precio sin impuestos nacionales" (Figma).
    var noTaxLabel = document.querySelector(".price-without-taxes-label");
    if (noTaxLabel) {
      function fixLabel() {
        var t = (noTaxLabel.textContent || "").replace(/\s+/g, " ").trim();
        if (/nacionales/i.test(t)) return;
        noTaxLabel.textContent = t.replace(/precio sin impuestos/i, "Precio sin impuestos nacionales");
      }
      fixLabel();
      new MutationObserver(fixLabel).observe(noTaxLabel, { childList: true, characterData: true, subtree: true });
    }

    // Breadcrumbs: quitar "Inicio" (1er crumb + su separador) y pasar ">" a "/".
    var bc = document.querySelector(".js-product-detail .breadcrumbs");
    if (bc) {
      var first = bc.querySelector(".crumb");
      if (first && /inicio/i.test((first.textContent || "").trim())) {
        var sep = first.nextElementSibling;
        first.remove();
        if (sep && sep.classList.contains("separator")) sep.remove();
      }
      [].forEach.call(bc.querySelectorAll(".separator"), function (s) { s.textContent = "/"; });
    }
  }

  /* ------------------------------------------------------------------ */
  /* PDP — bloque 3: selectores de color por SKU-5 (imágenes de los       */
  /* productos hermanos). Hasta 5 thumbs + "+N colores" que abre modal.   */
  /* El color NO es variante: se agrupa por los primeros 5 chars del SKU. */
  /* ------------------------------------------------------------------ */
  function pdpThumb(s) {
    var imgs = pdpImagesById && pdpImagesById[String(s.id)];
    return (imgs && imgs[0]) || "";
  }
  function normURL(u) { return (u || "").replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, ""); }

  function initPdpColors() {
    if (!pdpMap || !pdpImagesById) return; // espera color-map Y las imágenes (para los thumbs)
    var det = document.querySelector(".js-product-detail");
    if (!det || det.getAttribute("data-kv-pdpcolors") === "1") return;
    var skuEl = document.querySelector(".js-product-sku");
    var full = skuEl ? (skuEl.getAttribute("data-kv-full") || skuEl.textContent || "") : "";
    var raw = full.replace(/[^a-z0-9]/gi, "");
    if (raw.length < 5) return;
    var group = (pdpMap.groups || {})[raw.slice(0, 5)];
    if (!Array.isArray(group) || group.length < 2) return;
    det.setAttribute("data-kv-pdpcolors", "1");

    var path = location.pathname.replace(/\/$/, "");
    var current = null;
    group.forEach(function (s) { if (normURL(s.url) === path) current = s; });

    var ordered = [];
    if (current) ordered.push(current);
    group.forEach(function (s) { if (s !== current) ordered.push(s); });

    var MAX = window.innerWidth < 768 ? 4 : 5; // mobile: 4 + "+N colores"; desktop: 5
    var shown = ordered.slice(0, MAX);
    var remaining = ordered.length - shown.length;

    var block = document.createElement("div");
    block.className = "kv-pdp-colors";
    var title = document.createElement("div");
    title.className = "kv-pdp-colors-title";
    title.textContent = "Color: " + ((current && current.name) || "");
    block.appendChild(title);
    var list = document.createElement("div");
    list.className = "kv-pdp-colors-list";
    shown.forEach(function (s) {
      var a = document.createElement("a");
      a.className = "kv-pdp-color" + (s === current ? " is-active" : "");
      a.href = s.url;
      a.title = s.name || "";
      var t = pdpThumb(s);
      if (t) a.style.backgroundImage = "url('" + t + "')"; else a.style.background = s.color || "#eee";
      list.appendChild(a);
    });
    if (remaining > 0) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "kv-pdp-colors-more";
      more.innerHTML = "+ " + remaining + "<span>colores</span>";
      more.addEventListener("click", function () { openPdpColorsModal(ordered, current); });
      list.appendChild(more);
    }
    block.appendChild(list);

    var sizeVariant = det.querySelector(".js-product-variants");
    if (sizeVariant && sizeVariant.parentElement) sizeVariant.parentElement.insertBefore(block, sizeVariant);
    else { var pc = det.querySelector(".product-content"); if (pc) pc.appendChild(block); }

    // ocultar la variante "Color" nativa (el color va por SKU-5)
    det.querySelectorAll(".js-product-variants-group").forEach(function (g) {
      if (/color/i.test((g.textContent || "").trim().slice(0, 10))) g.style.setProperty("display", "none", "important");
    });
  }

  function closePdpModal(ov) {
    ov.classList.remove("open");
    document.documentElement.classList.remove("f2tn-lock");
  }

  function openPdpColorsModal(list, current) {
    var ov = document.querySelector(".kv-pdp-colors-modal-ov");
    if (!ov) {
      ov = document.createElement("div");
      // .kv-pdp-modal-ov = animación/panel compartido de las modales de ficha;
      // .kv-pdp-colors-modal-ov = hook específico de la de colores.
      ov.className = "kv-pdp-modal-ov kv-pdp-colors-modal-ov";
      ov.innerHTML =
        '<div class="kv-pdp-modal-panel" role="dialog" aria-label="Seleccionar color">' +
        '<div class="kv-pdp-modal-header"><h3 class="kv-pdp-modal-header-title">Seleccionar color</h3>' +
        '<button type="button" class="kv-pdp-modal-x" aria-label="Cerrar"></button></div>' +
        '<div class="kv-pdp-modal-body"><div class="kv-pdp-colors-modal-grid"></div></div>' +
        "</div>";
      document.body.appendChild(ov);
      // cierre: click en overlay (no en el panel) o en la ✕
      ov.addEventListener("click", function (e) {
        if (e.target === ov || e.target.closest(".kv-pdp-modal-x")) closePdpModal(ov);
      });
      // cierre con Esc (sólo si está abierta)
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) closePdpModal(ov);
      });
    }
    var grid = ov.querySelector(".kv-pdp-colors-modal-grid");
    grid.innerHTML = "";
    list.forEach(function (s) {
      var a = document.createElement("a");
      a.className = "kv-pdp-modal-color" + (s === current ? " is-active" : "");
      a.href = s.url;
      var t = pdpThumb(s);
      var span = document.createElement("span");
      span.className = "kv-pdp-modal-thumb";
      if (t) span.style.backgroundImage = "url('" + t + "')";
      var nm = document.createElement("span");
      nm.className = "kv-pdp-modal-name";
      nm.textContent = s.name || "";
      a.appendChild(span); a.appendChild(nm);
      grid.appendChild(a);
    });
    void ov.offsetWidth; ov.classList.add("open"); // reflow -> el estado inicial se pinta antes del slide (evita apertura brusca la 1ra vez)
    document.documentElement.classList.add("f2tn-lock");
  }

  /* ------------------------------------------------------------------ */
  /* PDP — Modal "Descripción y cuidados" (Figma 1264-29998). Panel       */
  /* derecho; estructura del Figma (título "Descripción del producto" +   */
  /* la descripción REAL del producto, dinámica). Cuidados/composición    */
  /* con íconos requieren data estructurada que el producto nativo no      */
  /* expone → se muestra la descripción libre del cliente.                 */
  /* ------------------------------------------------------------------ */
  function openPdpDescModal() {
    var ov = document.querySelector(".kv-pdp-desc-modal-ov");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "kv-pdp-modal-ov kv-pdp-desc-modal-ov";
      ov.innerHTML =
        '<div class="kv-pdp-modal-panel" role="dialog" aria-label="Descripción y cuidados">' +
        '<div class="kv-pdp-modal-header"><h3 class="kv-pdp-modal-header-title">Descripción y cuidados</h3>' +
        '<button type="button" class="kv-pdp-modal-x" aria-label="Cerrar"></button></div>' +
        '<div class="kv-pdp-modal-body"><section class="kv-desc-section">' +
        '<h4 class="kv-desc-heading">Descripción del producto</h4>' +
        '<div class="kv-desc-text"></div></section></div>' +
        "</div>";
      document.body.appendChild(ov);
      ov.addEventListener("click", function (e) {
        if (e.target === ov || e.target.closest(".kv-pdp-modal-x")) closePdpModal(ov);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) closePdpModal(ov);
      });
      // mover la descripción real del producto adentro (dinámico)
      var descBox = document.querySelector(".product-info-description");
      var descText = descBox ? descBox.querySelector(".js-product-description") : null;
      var target = ov.querySelector(".kv-desc-text");
      if (descText) target.appendChild(descText);
      else if (descBox) target.innerHTML = (descBox.textContent || "").trim();
    }
    void ov.offsetWidth; ov.classList.add("open"); // reflow -> el estado inicial se pinta antes del slide (evita apertura brusca la 1ra vez)
    document.documentElement.classList.add("f2tn-lock");
  }

  // Guarda el calculador de envío nativo (lo saca del layout en initPdpTabs para
  // que no deje hueco; el modal de "Medios de envío" lo monta al abrirse).
  var pdpShipBox = null;

  /* ------------------------------------------------------------------ */
  /* PDP — Modal "Formas de pago, promociones y reintegros" (Figma       */
  /* 1264-30277). Panel derecho: intro + "Ver todas las promociones" +   */
  /* lista de promos (logo + título + descripción). CONTENIDO HARDCODE    */
  /* del Figma → editable pendiente (no hay fuente en el admin todavía).  */
  /* ------------------------------------------------------------------ */
  var PROMO_IMG = "https://powecommerce.github.io/kevingston-css/img/";
  var PROMO_TRUCK = '<svg viewBox="0 0 28 23" fill="none"><g transform="translate(0 0.3)"><path d="M18.4041 15.9232V0.50651M18.3886 0.5C18.3886 0.5 6.67678 0.5 0.518975 0.5M0.5 0.539498C0.5 7.65839 0.5 18.7686 0.5 18.7686M0.519048 18.7619H3.69848M27.1667 10.5201H18.4062M24.3171 18.366H25.0475C25.609 18.366 26.1474 18.1429 26.5445 17.7459C26.9415 17.3489 27.1645 16.8104 27.1645 16.2489V9.8977L24.2155 3.85768C24.0412 3.50201 23.7707 3.20237 23.4346 2.99279C23.0985 2.78322 22.7104 2.67212 22.3143 2.67212H18.7852" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.8607 18.9225H10.6429M3.99947 18.9861C3.99947 19.7699 4.31085 20.5216 4.8651 21.0759C5.41935 21.6301 6.17108 21.9415 6.95491 21.9415C7.73874 21.9415 8.49046 21.6301 9.04472 21.0759C9.59897 20.5216 9.91034 19.7699 9.91034 18.9861C9.91034 18.2022 9.59897 17.4505 9.04472 16.8963C8.49046 16.342 7.73874 16.0306 6.95491 16.0306C6.17108 16.0306 5.41935 16.342 4.8651 16.8963C4.31085 17.4505 3.99947 18.2022 3.99947 18.9861ZM17.4154 18.9861C17.4154 19.3742 17.4918 19.7585 17.6403 20.1171C17.7889 20.4756 18.0066 20.8014 18.281 21.0759C18.5554 21.3503 18.8812 21.568 19.2398 21.7165C19.5984 21.8651 19.9827 21.9415 20.3708 21.9415C20.7589 21.9415 21.1432 21.8651 21.5018 21.7165C21.8604 21.568 22.1862 21.3503 22.4606 21.0759C22.7351 20.8014 22.9527 20.4756 23.1013 20.1171C23.2498 19.7585 23.3262 19.3742 23.3262 18.9861C23.3262 18.5979 23.2498 18.2136 23.1013 17.8551C22.9527 17.4965 22.7351 17.1707 22.4606 16.8963C22.1862 16.6218 21.8604 16.4041 21.5018 16.2556C21.1432 16.1071 20.7589 16.0306 20.3708 16.0306C19.9827 16.0306 19.5984 16.1071 19.2398 16.2556C18.8812 16.4041 18.5554 16.6218 18.281 16.8963C18.0066 17.1707 17.7889 17.4965 17.6403 17.8551C17.4918 18.2136 17.4154 18.5979 17.4154 18.9861Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';
  var PROMO_ITEMS = [
    { img: "promo-santander.png", title: "¡SÚPER MIÉRCOLES!", desc: "25% de ahorro segmento Sorpresa abonando con QR desde App Santander y App MODO. Sin tope de reintegro. Hasta 6 cuotas sin interés." },
    { svg: PROMO_TRUCK, title: "ENVÍOS GRATIS", desc: "Envíos gratis a todo el país en compras superiores a $180.000" },
    { img: "promo-cuotas.png", title: "CUOTAS SIN INTERÉS", desc: "Válido para tarjetas bancarias VISA, MASTER y AMEX emitidas por entidades bancarias, Mercado Pago y MODO. 3 cuotas sin interés sin mínimo de compra. 6 cuotas sin interés con un mínimo de compra de $100.000, no aplica para pagos realizados con MODO." },
    { img: "promo-malvinas.png", title: "BENEFICIO VETERANOS MALVINAS", desc: "¡10% OFF + 3 cuotas sin interés! Acumulable con promociones. Para obtenerlo, contactanos a través de nuestro chat." }
  ];
  function openPdpPayModal() {
    var ov = document.querySelector(".kv-pdp-pay-modal-ov");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "kv-pdp-modal-ov kv-pdp-pay-modal-ov";
      var items = PROMO_ITEMS.map(function (it) {
        var ico = it.svg ? it.svg : '<img src="' + PROMO_IMG + it.img + '" alt="" loading="lazy">';
        return '<li class="kv-pay-item"><span class="kv-pay-ico">' + ico + '</span>' +
          '<div class="kv-pay-info"><h4 class="kv-pay-title">' + it.title + '</h4>' +
          '<p class="kv-pay-desc">' + it.desc + '</p></div></li>';
      }).join("");
      ov.innerHTML =
        '<div class="kv-pdp-modal-panel" role="dialog" aria-label="Formas de pago, promociones y reintegros">' +
        '<div class="kv-pdp-modal-header"><h3 class="kv-pdp-modal-header-title">Formas de pago, promociones y reintegros</h3>' +
        '<button type="button" class="kv-pdp-modal-x" aria-label="Cerrar"></button></div>' +
        '<div class="kv-pdp-modal-body">' +
        '<p class="kv-pay-intro">Podes abonar con tarjeta de débito, crédito o en efectivo a través de RapiPago, Pago Fácil y Provincia NET Pagos.</p>' +
        '<a class="kv-pay-link" href="#">Ver todas las promociones</a>' +
        '<ul class="kv-pay-list">' + items + '</ul>' +
        '</div></div>';
      document.body.appendChild(ov);
      ov.addEventListener("click", function (e) {
        if (e.target === ov || e.target.closest(".kv-pdp-modal-x")) closePdpModal(ov);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) closePdpModal(ov);
      });
    }
    void ov.offsetWidth; ov.classList.add("open"); // reflow -> el estado inicial se pinta antes del slide (evita apertura brusca la 1ra vez)
    document.documentElement.classList.add("f2tn-lock");
  }

  /* ------------------------------------------------------------------ */
  /* PDP — Modal "Medios de envío" (Figma 1264-30169). Panel derecho con  */
  /* el calculador de envío NATIVO montado adentro (input CP + Calcular). */
  /* ------------------------------------------------------------------ */
  function openPdpShippingModal() {
    var ov = document.querySelector(".kv-pdp-ship-modal-ov");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "kv-pdp-modal-ov kv-pdp-ship-modal-ov";
      ov.innerHTML =
        '<div class="kv-pdp-modal-panel" role="dialog" aria-label="Medios de envío">' +
        '<div class="kv-pdp-modal-header"><h3 class="kv-pdp-modal-header-title">Medios de envío</h3>' +
        '<button type="button" class="kv-pdp-modal-x" aria-label="Cerrar"></button></div>' +
        '<div class="kv-pdp-modal-body"><h4 class="kv-ship-heading">Verifica los medios de envío</h4>' +
        '<div class="kv-ship-calc"></div></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener("click", function (e) {
        if (e.target === ov || e.target.closest(".kv-pdp-modal-x")) closePdpModal(ov);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) closePdpModal(ov);
      });
      // montar el calculador nativo (guardado por initPdpTabs) adentro del modal
      var host = ov.querySelector(".kv-ship-calc");
      if (pdpShipBox) host.appendChild(pdpShipBox);
      else host.innerHTML = "<p>Ingresá tu código postal para calcular los medios de envío y tiempos de entrega.</p>";
    }
    void ov.offsetWidth; ov.classList.add("open"); // reflow -> el estado inicial se pinta antes del slide (evita apertura brusca la 1ra vez)
    document.documentElement.classList.add("f2tn-lock");
  }

  /* ------------------------------------------------------------------ */
  /* PDP — Modal "Cambios y devoluciones" (Figma 1264-30155). Panel       */
  /* derecho, texto del Figma + "Más información". HARDCODE → editable     */
  /* pendiente.                                                            */
  /* ------------------------------------------------------------------ */
  function openPdpReturnsModal() {
    var ov = document.querySelector(".kv-pdp-ret-modal-ov");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "kv-pdp-modal-ov kv-pdp-ret-modal-ov";
      ov.innerHTML =
        '<div class="kv-pdp-modal-panel" role="dialog" aria-label="Cambios y devoluciones">' +
        '<div class="kv-pdp-modal-header"><h3 class="kv-pdp-modal-header-title">Cambios y devoluciones</h3>' +
        '<button type="button" class="kv-pdp-modal-x" aria-label="Cerrar"></button></div>' +
        '<div class="kv-pdp-modal-body">' +
        '<div class="kv-ret-text">' +
        '<p class="kv-ret-p">Contas con 30 días desde la recepción de tu pedido para solicitar el cambio de tus productos, y/o 10 días para gestionar la devolución.</p>' +
        '<p class="kv-ret-p">Los cambios se realizan por la misma prenda en otro talle, u otro producto que desees por el valor abonado.</p>' +
        '</div>' +
        '<a class="kv-ret-link" href="#">Más información</a>' +
        '</div></div>';
      document.body.appendChild(ov);
      ov.addEventListener("click", function (e) {
        if (e.target === ov || e.target.closest(".kv-pdp-modal-x")) closePdpModal(ov);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) closePdpModal(ov);
      });
    }
    void ov.offsetWidth; ov.classList.add("open"); // reflow -> el estado inicial se pinta antes del slide (evita apertura brusca la 1ra vez)
    document.documentElement.classList.add("f2tn-lock");
  }

  /* ------------------------------------------------------------------ */
  /* PDP — bloque 1: galería stacked (Figma). El nativo es un Swiper;    */
  /* lo pasamos a grid vertical con la lógica 1-2-2-1 (5+), 1-2-1 (4),    */
  /* 2 grandes (2). El CSS fuerza el grid; acá asignamos full/half.       */
  /* ------------------------------------------------------------------ */
  function initPdpGallery() {
    if (window.innerWidth < 768) return; // mobile: se deja el Swiper (slider), no stacked
    var slider = document.querySelector(".js-product-slider.swiper-container");
    if (!slider || slider.getAttribute("data-kv-gallery") === "1") return;
    var wrapper = slider.querySelector(".swiper-wrapper");
    if (!wrapper) return;
    var slides = [].slice.call(wrapper.children).filter(function (s) { return s.querySelector && s.querySelector("img"); });
    if (!slides.length) return;
    slider.setAttribute("data-kv-gallery", "1");
    // cargar las imágenes lazy ANTES de destruir el swiper (si no quedan en placeholder)
    if (slider.swiper && slider.swiper.lazy && slider.swiper.lazy.loadInSlide) {
      try { for (var li = 0; li < slides.length; li++) slider.swiper.lazy.loadInSlide(li); } catch (e) {}
    }
    // forzar la imagen real: la URL vive en srcset/data-srcset/data-src (el src es un placeholder)
    slides.forEach(function (s) {
      var img = s.querySelector("img");
      if (!img) return;
      var real = img.getAttribute("srcset") || img.getAttribute("data-srcset") || img.getAttribute("data-src") || "";
      var parts = real.split(",").map(function (c) { var sp = c.trim().split(/\s+/); return { url: sp[0], w: parseInt(sp[1], 10) || 0 }; })
        .filter(function (x) { return x.url && !/^data:/.test(x.url); });
      parts.sort(function (a, b) { return a.w - b.w; });
      // elegir la más chica que sea >=800w (buena para el display), o la más grande
      var pick = parts.filter(function (x) { return x.w >= 800; })[0] || parts[parts.length - 1];
      var url = pick && pick.url;
      if (url) {
        if (url.indexOf("//") === 0) url = "https:" + url;
        img.removeAttribute("srcset");
        img.removeAttribute("data-srcset");
        img.src = url;
      }
      img.classList.remove("swiper-lazy");
    });
    if (slider.swiper) { try { slider.swiper.destroy(true, true); } catch (e) {} }
    slider.classList.add("kv-gallery-stacked");
    slides.forEach(function (s) { s.classList.add("kv-gslide"); s.classList.remove("kv-gfull", "kv-ghalf"); });
    // 1ª imagen SIEMPRE full; el resto en pares de 2 chicas; si al final quedaría
    // una sola chica, esa va full (nunca una chica sola en la última fila).
    // 1=1 · 2=1-1 · 3=1-2 · 4=1-2-1 · 5=1-2-2 · 6=1-2-2-1 · 7=1-2-2-2 ...
    slides[0].classList.add("kv-gfull");
    var rest = slides.slice(1);
    rest.forEach(function (s, i) {
      if (i === rest.length - 1 && rest.length % 2 === 1) s.classList.add("kv-gfull");
      else s.classList.add("kv-ghalf");
    });
  }

  /* ------------------------------------------------------------------ */
  /* PDP — Zoom de galería (Figma 3995-25646). Lightbox al clickear una   */
  /* imagen de la galería stacked (desktop): overlay + imagen centrada +   */
  /* contador "N / total" + flechas 48px + ✕. El zoom nativo dependía del   */
  /* Swiper (destruido por initPdpGallery), por eso se arma custom.         */
  /* ------------------------------------------------------------------ */
  function initPdpZoom() {
    if (window.innerWidth < 768) return; // desktop (galería stacked)
    var gallery = document.querySelector(".js-product-slider.kv-gallery-stacked");
    if (!gallery || gallery.getAttribute("data-kv-zoom") === "1") return;
    var imgEls = [].slice.call(gallery.querySelectorAll("img")).filter(function (im) {
      var s = im.getAttribute("src"); return s && !/^data:/.test(s);
    });
    if (!imgEls.length) return;
    gallery.setAttribute("data-kv-zoom", "1");
    // usar el ATRIBUTO src (URL real que puso initPdpGallery); NO currentSrc, que
    // devuelve el placeholder para las imágenes aún no cargadas (bajo el fold).
    // imgEls ya está filtrado (src real), así que los índices quedan alineados.
    var srcs = imgEls.map(function (im) { return im.getAttribute("src"); });
    var idx = 0, ov = null, imgNode = null, countNode = null;

    function show() {
      imgNode.src = srcs[idx];
      countNode.textContent = (idx + 1) + " / " + srcs.length;
    }
    function go(d) { idx = (idx + d + srcs.length) % srcs.length; show(); }
    function close() {
      if (ov) ov.classList.remove("open");
      document.documentElement.classList.remove("f2tn-lock");
    }
    function build() {
      ov = document.createElement("div");
      ov.className = "kv-zoom-ov";
      ov.innerHTML =
        '<div class="kv-zoom-count"></div>' +
        '<button type="button" class="kv-zoom-close" aria-label="Cerrar"></button>' +
        '<button type="button" class="kv-zoom-arrow kv-zoom-prev" aria-label="Anterior"></button>' +
        '<img class="kv-zoom-img" alt="">' +
        '<button type="button" class="kv-zoom-arrow kv-zoom-next" aria-label="Siguiente"></button>';
      document.body.appendChild(ov);
      imgNode = ov.querySelector(".kv-zoom-img");
      countNode = ov.querySelector(".kv-zoom-count");
      ov.addEventListener("click", function (e) {
        if (e.target.closest(".kv-zoom-prev")) go(-1);
        else if (e.target.closest(".kv-zoom-next")) go(1);
        else if (e.target === ov || e.target.closest(".kv-zoom-close")) close();
      });
      document.addEventListener("keydown", function (e) {
        if (!ov.classList.contains("open")) return;
        if (e.key === "Escape") close();
        else if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "ArrowRight") go(1);
      });
    }
    function open(i) {
      if (!ov) build();
      idx = i; show();
      void ov.offsetWidth; ov.classList.add("open"); // reflow -> el estado inicial se pinta antes del slide (evita apertura brusca la 1ra vez)
      document.documentElement.classList.add("f2tn-lock");
    }
    imgEls.forEach(function (im, i) {
      im.style.cursor = "zoom-in";
      var link = im.closest("a");
      (link || im).addEventListener("click", function (e) {
        if (!e.isTrusted) return; // ignorar clicks sintéticos (el nativo dispara clicks al init -> abría solo)
        e.preventDefault(); e.stopPropagation(); open(i);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* PDP — bloque 6: 4 solapas descriptivas (accordion). Figma 1184-24198.*/
  /* 1 Descripción (real) · 2 Formas de pago (editable) · 3 Tiempos de     */
  /* entrega (calculador nativo) · 4 Cambios y devoluciones (editable).    */
  /* ------------------------------------------------------------------ */
  function initPdpTabs() {
    var det = document.querySelector(".js-product-detail");
    if (!det || det.getAttribute("data-kv-tabs") === "1") return;
    var descBox = document.querySelector(".product-info-description");
    if (!descBox) return;
    det.setAttribute("data-kv-tabs", "1");

    // Íconos EXACTOS del Figma (assets 2340:20272). tshirt/card ya son 24x24;
    // truck y returns tienen viewBox propio → los centro en 24x24 con translate.
    var IC = {
      desc: '<svg viewBox="0 0 24 24" fill="none"><path d="M11.9987 7.82688C13.1515 7.82688 14.0853 6.89315 14.0853 5.74032H15.4806C15.924 5.74032 16.3492 5.91507 16.6622 6.22805L19.7555 9.32399C20.0815 9.65001 20.0815 10.1795 19.7555 10.5055L18.4331 11.8279C18.1071 12.1539 17.5776 12.1539 17.2516 11.8279L16.1718 10.7481V16.5904C16.1718 17.5111 15.4233 18.2597 14.5026 18.2597H9.49482C8.57413 18.2597 7.82558 17.5111 7.82558 16.5904V10.7481L6.74578 11.8279C6.41976 12.1539 5.89029 12.1539 5.56427 11.8279L4.24452 10.5029C3.91849 10.1769 3.91849 9.6474 4.24452 9.32138L7.33784 6.22805C7.65083 5.91507 8.07596 5.74032 8.51936 5.74032H9.91475C9.91475 6.89315 10.8485 7.82688 12.0013 7.82688H11.9987Z" stroke="currentColor" stroke-linejoin="round"/></svg>',
      pay: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 9.33333V8.62222C4 7.62667 4 7.12889 4.19378 6.74844C4.36444 6.41333 4.63556 6.14222 4.97067 5.97156C5.35111 5.77778 5.84889 5.77778 6.84444 5.77778H17.1556C18.1511 5.77778 18.6489 5.77778 19.0284 5.97156C19.3636 6.14222 19.6356 6.41333 19.8062 6.74844C20 7.128 20 7.62578 20 8.61956V9.33333M4 9.33333H20M4 9.33333V15.3778C4 16.3733 4 16.8711 4.19378 17.2516C4.36422 17.5861 4.63617 17.858 4.97067 18.0284C5.35022 18.2222 5.848 18.2222 6.84178 18.2222H17.1582C18.152 18.2222 18.6489 18.2222 19.0284 18.0284C19.3636 17.8578 19.6356 17.5858 19.8062 17.2516C20 16.8711 20 16.3751 20 15.3813V9.33333M6.66667 14.6667H10.2222" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      delivery: '<svg viewBox="0 0 24 24" fill="none"><g transform="translate(3.5 5.07)"><path d="M11.2425 9.75392V0.503906M11.2332 0.5C11.2332 0.5 4.20607 0.5 0.511385 0.5M0.5 0.523699C0.5 4.79503 0.5 11.4611 0.5 11.4611M0.511429 11.4571H2.41909M16.5 6.51207H11.2437M14.7903 11.2196H15.2285C15.5654 11.2196 15.8885 11.0858 16.1267 10.8475C16.3649 10.6093 16.4987 10.2862 16.4987 9.94935V6.13862L14.7293 2.51461C14.6247 2.30121 14.4624 2.12142 14.2608 1.99568C14.0591 1.86993 13.8262 1.80327 13.5886 1.80327H11.4711" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.3163 11.5535H6.5856M2.59957 11.5916C2.59957 12.0619 2.78639 12.513 3.11895 12.8455C3.4515 13.1781 3.90253 13.3649 4.37283 13.3649C4.84313 13.3649 5.29416 13.1781 5.62672 12.8455C5.95927 12.513 6.14609 12.0619 6.14609 11.5916C6.14609 11.1214 5.95927 10.6703 5.62672 10.3378C5.29416 10.0052 4.84313 9.81839 4.37283 9.81839C3.90253 9.81839 3.4515 10.0052 3.11895 10.3378C2.78639 10.6703 2.59957 11.1214 2.59957 11.5916ZM10.6491 11.5916C10.6491 11.8245 10.695 12.0551 10.7841 12.2702C10.8732 12.4854 11.0038 12.6809 11.1685 12.8455C11.3331 13.0102 11.5286 13.1408 11.7438 13.2299C11.9589 13.319 12.1895 13.3649 12.4224 13.3649C12.6552 13.3649 12.8858 13.319 13.101 13.2299C13.3161 13.1408 13.5116 13.0102 13.6763 12.8455C13.8409 12.6809 13.9715 12.4854 14.0607 12.2702C14.1498 12.0551 14.1956 11.8245 14.1956 11.5916C14.1956 11.3588 14.1498 11.1282 14.0607 10.9131C13.9715 10.6979 13.8409 10.5024 13.6763 10.3378C13.5116 10.1731 13.3161 10.0425 13.101 9.95337C12.8858 9.86426 12.6552 9.81839 12.4224 9.81839C12.1895 9.81839 11.9589 9.86426 11.7438 9.95337C11.5286 10.0425 11.3331 10.1731 11.1685 10.3378C11.0038 10.5024 10.8732 10.6979 10.7841 10.9131C10.695 11.1282 10.6491 11.3588 10.6491 11.5916Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></g></svg>',
      returns: '<svg viewBox="0 0 24 24" fill="none"><g transform="translate(3.85 4.92)"><path d="M14.4937 5.46381C14.5283 5.59407 14.6483 5.68477 14.7854 5.68477C14.8108 5.68477 14.8361 5.6814 14.861 5.67513C15.0215 5.63315 15.1171 5.47008 15.0747 5.31183C14.2649 2.27234 11.4583 0.15 8.2498 0.15C5.21057 0.15 2.52403 2.0451 1.56397 4.86604L1.53616 4.94709L0.737567 2.97287C0.697076 2.85033 0.578531 2.7659 0.449254 2.7659C0.418032 2.7659 0.387298 2.77072 0.35754 2.78037C0.199968 2.83151 0.11362 2.99989 0.164843 3.15572C0.16777 3.16778 0.173624 3.17888 0.179478 3.19094L1.24346 5.82903C1.27419 5.90622 1.33566 5.96701 1.41176 5.99548C1.44786 6.00995 1.48738 6.01719 1.52543 6.01719C1.56933 6.01719 1.61129 6.00802 1.64934 5.98969L4.25147 4.82021C4.32367 4.78595 4.37831 4.72516 4.40514 4.6499C4.43197 4.57464 4.4271 4.4931 4.39246 4.42121C4.34319 4.31893 4.23781 4.25284 4.12415 4.25284C4.08317 4.25284 4.04268 4.26152 4.00463 4.27841L2.11571 5.12898L2.13864 5.05999C3.0109 2.47931 5.46619 0.745837 8.24834 0.745837C11.1866 0.745837 13.7541 2.68629 14.4937 5.46381Z" fill="currentColor" stroke="currentColor" stroke-width="0.3"/><path d="M14.7677 9.21903L15.5664 11.1934C15.6103 11.3121 15.724 11.3912 15.8499 11.3912C15.8846 11.3912 15.9192 11.3849 15.9524 11.3734C16.1085 11.3164 16.19 11.1451 16.1329 10.9917C16.131 10.9874 16.1266 10.9796 16.1251 10.9686L15.0639 8.33703C15.0327 8.26031 14.9712 8.19952 14.8951 8.17009C14.8209 8.14065 14.7316 8.14355 14.6565 8.17636L12.0549 9.34592C11.9797 9.37632 11.9222 9.43422 11.8909 9.50804C11.8602 9.58186 11.8602 9.66292 11.8909 9.73674C11.9378 9.8482 12.0466 9.92057 12.17 9.92057C12.21 9.92057 12.2486 9.91285 12.2852 9.8979L12.3037 9.88825L14.1939 9.03761L14.1705 9.10661C13.2913 11.6875 10.8331 13.4211 8.0525 13.4211C5.11572 13.4211 2.54781 11.481 1.80812 8.70276C1.77299 8.572 1.65345 8.48129 1.51635 8.48129C1.49098 8.48129 1.4656 8.48467 1.44023 8.49143C1.2802 8.5334 1.18408 8.69649 1.22652 8.85475C2.03208 11.8945 4.83907 14.0169 8.0525 14.0169C11.0888 14.0169 13.7758 12.1217 14.7389 9.30057L14.7677 9.21903Z" fill="currentColor" stroke="currentColor" stroke-width="0.3"/></g></svg>'
    };
    var CHEV = '<svg class="kv-tab-chev" viewBox="0 0 10.75 10.75" fill="none"><path d="M3 0.375L8 5.375L3 10.375" stroke="currentColor" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var wrap = document.createElement("div");
    wrap.className = "kv-pdp-tabs";

    // onClick opcional → la fila ABRE UN MODAL (panel derecho) en vez de desplegar
    // accordion (handoff: los facilitadores abren modales, no despliegan).
    function makeTab(icon, title, onClick) {
      var tab = document.createElement("div"); tab.className = "kv-pdp-tab";
      var head = document.createElement("button"); head.type = "button"; head.className = "kv-pdp-tab-head";
      head.innerHTML = '<span class="kv-tab-ico">' + icon + "</span><span class=\"kv-tab-title\">" + title + "</span>" + CHEV;
      tab.appendChild(head);
      wrap.appendChild(tab);
      if (onClick) { head.addEventListener("click", onClick); return null; }
      var body = document.createElement("div"); body.className = "kv-pdp-tab-body";
      var inner = document.createElement("div"); inner.className = "kv-pdp-tab-inner";
      body.appendChild(inner);
      head.addEventListener("click", function () {
        var open = tab.classList.contains("open");
        wrap.querySelectorAll(".kv-pdp-tab.open").forEach(function (t) { t.classList.remove("open"); });
        if (!open) tab.classList.add("open");
      });
      tab.appendChild(body);
      return inner;
    }

    // Las 4 filas abren MODAL (panel derecho), no accordion (Figma: facilitadores
    // = modales). 1 Descripción (dinámica) · 2 Formas de pago/promos (1264-30277)
    // · 3 Medios de envío (1264-30169, calc nativo) · 4 Cambios (1264-30155).
    makeTab(IC.desc, "Descripción y cuidados", openPdpDescModal);
    makeTab(IC.pay, "Formas de pago, promociones y reintegros", openPdpPayModal);
    makeTab(IC.delivery, "Tiempos de entrega y medios de envío", openPdpShippingModal);
    makeTab(IC.returns, "Cambios y devoluciones", openPdpReturnsModal);

    // sacar el calculador de envío nativo del layout (deja hueco de ~100px si
    // queda suelto) y guardarlo para montarlo dentro del modal de Medios de envío.
    pdpShipBox = document.querySelector(".product-shipping-wrapper") || document.querySelector(".shipping-calculator");
    if (pdpShipBox && pdpShipBox.parentNode) pdpShipBox.parentNode.removeChild(pdpShipBox);

    // insertar el accordion DENTRO de .product-content (después del form) para
    // que no le aplique el gap:40 flex de .js-product-info; el ritmo botón→solapas
    // lo controla el margin-top de .kv-pdp-tabs (24, Figma).
    var pc = det.querySelector(".product-content");
    var form = det.querySelector(".js-product-form");
    if (pc && form) pc.insertBefore(wrap, form.nextSibling);
    else descBox.parentNode.insertBefore(wrap, descBox);
    descBox.style.display = "none";
    var purchase = document.querySelector(".product-purchase-info");
    if (purchase) purchase.style.setProperty("display", "none", "important");
  }

  /* ------------------------------------------------------------------ */
  /* PDP — bloque 4: links "Guía de talles" (izq) + "Conocé tu talle"     */
  /* (der) debajo de los botones de talle (Figma 2340:20266).             */
  /* Guía de talles abre un modal (contenido lo carga el cliente).        */
  /* Conocé tu talle = app Ready Size (dispara su trigger si existe).      */
  /* ------------------------------------------------------------------ */
  function initPdpSizeLinks() {
    var det = document.querySelector(".js-product-detail");
    if (!det) return;

    function hasSizes() {
      var ok = false;
      [].forEach.call(det.querySelectorAll(".js-product-variants-group"), function (g) {
        if (/talle/i.test((g.textContent || "").slice(0, 40)) && g.querySelector(".btn-variant:not(.btn-variant-color)")) ok = true;
      });
      return ok;
    }

    function apply() {
      // El label ("Talles") ya lo hace el CSS (::before). Acá sólo los links.
      // Se insertan como HERMANO después de .js-product-variants (contenedor que el
      // nativo re-renderiza por dentro pero NO reemplaza a sus hermanos) → sobreviven.
      if (det.querySelector(".kv-pdp-sizelinks")) return;
      var vars = det.querySelector(".js-product-variants");
      if (!vars || !vars.parentElement || !hasSizes()) return;
      var row = document.createElement("div");
      row.className = "kv-pdp-sizelinks";
      var guia = document.createElement("button");
      guia.type = "button"; guia.className = "kv-sizelink kv-sizeguide-open"; guia.textContent = "Guía de talles";
      var fit = document.createElement("button");
      fit.type = "button"; fit.className = "kv-sizelink kv-fitting-open"; fit.textContent = "Conocé tu talle";
      row.appendChild(guia); row.appendChild(fit);
      vars.parentElement.insertBefore(row, vars.nextSibling);
      guia.addEventListener("click", function () { openSizeGuide(); });
      fit.addEventListener("click", function () { openSizeFitModal(); });
    }

    apply();
    // backup: si el nativo llegara a borrar los links, se re-inyectan.
    new MutationObserver(function () { apply(); }).observe(det, { childList: true, subtree: true });
    [400, 1200, 3000].forEach(function (ms) { setTimeout(apply, ms); });
  }

  /* ------------------------------------------------------------------ */
  /* PDP — texto del botón: "Agregar al carrito" → "Agregar al Carrito"   */
  /* (Figma). Sólo toca el texto por defecto; respeta estados nativos     */
  /* ("Agregando...", "Sin stock", etc.) porque matchea exacto.           */
  /* ------------------------------------------------------------------ */
  function initPdpBtnText() {
    var cont = document.querySelector(".js-product-detail .buy-button-container");
    if (!cont) return;
    function fix() {
      [].forEach.call(cont.querySelectorAll("input.js-addtocart,button.js-addtocart,.js-addtocart"), function (b) {
        if (b.tagName === "INPUT") { if (b.value === "Agregar al carrito") b.value = "Agregar al Carrito"; }
        else if (!b.children.length && (b.textContent || "").trim() === "Agregar al carrito") b.textContent = "Agregar al Carrito";
      });
    }
    fix();
    new MutationObserver(fix).observe(cont, { childList: true, subtree: true });
  }

  /* PDP — C2 (QA): cucardas arriba del título. Lee el % de descuento nativo
     (.js-offer-label.product-offer-label -> "60% OFF") y la promo
     (.promotion-detail-title.label-primary -> "Llevá 2 y pagá 1!") y las inyecta
     como pills (descuento rojo + promo naranja) antes del nombre. Figma 1288-30575. */
  function initPdpBadges() {
    var det = document.querySelector(".js-product-detail");
    if (!det || det.getAttribute("data-kv-badges") === "1") return;
    var name = det.querySelector(".js-product-name, .product-name");
    if (!name) return;
    det.setAttribute("data-kv-badges", "1");
    var row = document.createElement("div");
    row.className = "kv-pdp-badges";
    function addPill(txt, cls) {
      if (!txt) return;
      var s = document.createElement("span");
      s.className = "kv-pdp-badge " + cls;
      s.textContent = txt;
      row.appendChild(s);
    }
    var off = det.querySelector(".js-offer-label.product-offer-label, .js-offer-label, .product-offer-label");
    addPill(off && (off.textContent || "").trim(), "kv-pdp-badge-off");
    var promo = det.querySelector(".promotion-detail-title.label-primary, .promotion-detail-title");
    addPill(promo && (promo.textContent || "").trim(), "kv-pdp-badge-promo");
    if (row.children.length) name.parentNode.insertBefore(row, name);
  }

  /* PDP — G1 (QA): NO hay talle seleccionado por default. Se deselecciona el que TN
     preselecciona; y si se toca el CTA sin talle elegido, la leyenda pasa de
     "Agregar al Carrito" a "Seleccioná tu talle" (y no agrega al carrito). Al elegir
     un talle vuelve a "Agregar al Carrito". Solo aplica si el producto TIENE talles. */
  function initPdpSizeGate() {
    var det = document.querySelector(".js-product-detail");
    if (!det || det.getAttribute("data-kv-sizegate") === "1") return;
    function sizeBtns() { return det.querySelectorAll(".btn-variant:not(.btn-variant-color)"); }
    if (!sizeBtns().length) return; // producto sin talles -> sin gate
    det.setAttribute("data-kv-sizegate", "1");
    var cont = det.querySelector(".buy-button-container") || det;
    var userPicked = false;

    function ctaBtns() { return cont.querySelectorAll("input.js-addtocart,button.js-addtocart,.js-addtocart"); }
    function setLabel(txt) {
      [].forEach.call(ctaBtns(), function (b) {
        if (b.tagName === "INPUT") { b.value = txt; return; }
        var s = b.querySelector(".js-addtocart-text");
        if (s) s.textContent = txt; else b.textContent = txt;
      });
    }
    function anySelected() {
      var b = sizeBtns();
      for (var i = 0; i < b.length; i++) if (b[i].classList.contains("selected")) return true;
      return false;
    }
    function deselect() { if (!userPicked) [].forEach.call(sizeBtns(), function (b) { b.classList.remove("selected"); }); }
    deselect();
    [100, 400, 1000, 2000].forEach(function (ms) { setTimeout(deselect, ms); });

    // al elegir un talle (con stock) -> CTA vuelve a "Agregar al Carrito"
    det.addEventListener("click", function (e) {
      var sb = e.target.closest && e.target.closest(".btn-variant:not(.btn-variant-color)");
      if (sb && !sb.classList.contains("btn-variant-no-stock")) { userPicked = true; setLabel("Agregar al Carrito"); }
    }, true);

    // gate del add-to-cart: sin talle -> "Seleccioná tu talle" (bloquea el alta)
    cont.addEventListener("click", function (e) {
      var cta = e.target.closest && e.target.closest(".js-addtocart");
      if (!cta) return;
      if (!anySelected()) {
        e.preventDefault(); e.stopImmediatePropagation();
        setLabel("Seleccioná tu talle");
        var grp = det.querySelector(".js-product-variants-group:not(.js-color-variants-container)");
        if (grp) { try { grp.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (x) {} }
      }
    }, true);
  }

  /* PDP — G2 (QA): al seleccionar un talle SIN STOCK, el CTA pasa a "Stock no
     Disponible" (disabled) y se inyecta "Avisarme cuando haya stock" (outline).
     TN no trae notify nativo -> el botón queda listo; conectar su backend (captura de
     email) es una feature de tienda aparte. Figma 4042-37306. */
  function initPdpOutOfStock() {
    var det = document.querySelector(".js-product-detail");
    if (!det || det.getAttribute("data-kv-oos") === "1") return;
    var cont = det.querySelector(".buy-button-container") || det.querySelector(".product-actions");
    if (!cont) return;
    det.setAttribute("data-kv-oos", "1");
    var notifyBtn = null;
    function cta() { return cont.querySelector("input.js-addtocart,button.js-addtocart,.js-addtocart"); }
    function txt(b) { return (b.value || b.textContent || "").trim().toLowerCase(); }
    function ensureNotify() {
      if (!notifyBtn) {
        notifyBtn = document.createElement("button");
        notifyBtn.type = "button";
        notifyBtn.className = "kv-pdp-notify-btn";
        notifyBtn.textContent = "Avisarme cuando haya stock";
        notifyBtn.addEventListener("click", function () {
          var nat = det.querySelector(".js-product-available-alert,[data-component*='available'],.js-notify-me");
          if (nat) { nat.click(); return; }
          notifyBtn.classList.add("kv-pdp-notify-done");
          notifyBtn.textContent = "Te avisaremos cuando haya stock";
        });
      }
      return notifyBtn;
    }
    function sync() {
      var b = cta();
      if (!b) return;
      var selNo = det.querySelector(".btn-variant-no-stock.selected:not(.btn-variant-color)");
      var oos = !!selNo || (b.disabled && txt(b).indexOf("sin stock") > -1);
      if (oos) {
        if (b.tagName === "INPUT") { if (b.value !== "Stock no Disponible") b.value = "Stock no Disponible"; }
        else if (txt(b) !== "stock no disponible") { var s = b.querySelector(".js-addtocart-text"); if (s) s.textContent = "Stock no Disponible"; else b.textContent = "Stock no Disponible"; }
        det.classList.add("kv-pdp-oos");
        var n = ensureNotify();
        if (!n.isConnected) (b.closest(".buy-button-container") || cont).appendChild(n);
      } else {
        det.classList.remove("kv-pdp-oos");
        if (notifyBtn && notifyBtn.isConnected) { notifyBtn.remove(); notifyBtn.classList.remove("kv-pdp-notify-done"); notifyBtn.textContent = "Avisarme cuando haya stock"; }
      }
    }
    sync();
    new MutationObserver(sync).observe(cont, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "value", "class"] });
    det.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".btn-variant:not(.btn-variant-color)")) setTimeout(sync, 60);
    }, true);
  }

  /* PDP — Bloque "Envío Same day" HARDCODEADO (sin app). Figma 1244-29952: caja
     #f6f5f3 radio 8, ícono camión en cajita blanca, texto bold+regular, con cuenta
     regresiva en vivo hasta fin del día. Va después de los desplegables. */
  function initPdpSameDay() {
    var det = document.querySelector(".js-product-detail");
    if (!det || det.getAttribute("data-kv-sameday") === "1") return;
    var anchor = det.querySelector(".kv-pdp-tabs") || det.querySelector(".buy-button-container");
    if (!anchor || !anchor.parentNode) return;
    det.setAttribute("data-kv-sameday", "1");
    var TRUCK = '<svg width="20" height="16" viewBox="0 0 21 17" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 14C18 14.663 17.7366 15.2989 17.2678 15.7678C16.7989 16.2366 16.163 16.5 15.5 16.5C14.837 16.5 14.2011 16.2366 13.7322 15.7678C13.2634 15.2989 13 14.663 13 14C13 13.337 13.2634 12.7011 13.7322 12.2322C14.2011 11.7634 14.837 11.5 15.5 11.5C16.163 11.5 16.7989 11.7634 17.2678 12.2322C17.7366 12.7011 18 13.337 18 14ZM8 14C8 14.663 7.73661 15.2989 7.26777 15.7678C6.79893 16.2366 6.16304 16.5 5.5 16.5C4.83696 16.5 4.20107 16.2366 3.73223 15.7678C3.26339 15.2989 3 14.663 3 14C3 13.337 3.26339 12.7011 3.73223 12.2322C4.20107 11.7634 4.83696 11.5 5.5 11.5C6.16304 11.5 6.79893 11.7634 7.26777 12.2322C7.73661 12.7011 8 13.337 8 14Z" stroke="black"/><path d="M13 14H8M0.5 0.5H10.5C11.914 0.5 12.621 0.5 13.06 0.94C13.5 1.378 13.5 2.085 13.5 3.5V12M14 3H15.801C16.631 3 17.046 3 17.39 3.195C17.734 3.389 17.947 3.745 18.374 4.457L20.073 7.287C20.285 7.641 20.391 7.819 20.446 8.015C20.5 8.212 20.5 8.418 20.5 8.831V11.5C20.5 12.435 20.5 12.902 20.299 13.25C20.1674 13.478 19.978 13.6674 19.75 13.799C19.402 14 18.935 14 18 14M0.5 9.5V11.5C0.5 12.435 0.5 12.902 0.701 13.25C0.832648 13.478 1.02199 13.6674 1.25 13.799C1.598 14 2.065 14 3 14M0.5 3.5H6.5M0.5 6.5H4.5" stroke="black" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var box = document.createElement("div");
    box.className = "kv-pdp-sameday";
    box.innerHTML = '<div class="kv-pdp-sameday-row"><span class="kv-pdp-sameday-ico">' + TRUCK + '</span><p class="kv-pdp-sameday-text"><strong>Envío Same day.</strong> Si vivís en CABA recibilo mañana comprando dentro de las próximas <span class="kv-pdp-sameday-count"></span>.</p></div>';
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    var countEl = box.querySelector(".kv-pdp-sameday-count");
    function upd() {
      var now = new Date();
      var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0); // próxima medianoche
      var diff = Math.max(0, end - now);
      var h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
      countEl.textContent = h + " hs " + m + " min";
    }
    upd();
    setInterval(upd, 30000);
  }

  /* PDP — Modal "Guía de talles" (Figma 2520-24913). Panel lateral (mismo    */
  /* sistema .kv-pdp-modal que los facilitadores): tabla de medidas + "Cómo    */
  /* medir" (ilustración) + 5 pasos. Los DATOS DE LA TABLA son PLACEHOLDER      */
  /* del Figma (S/01 y valores) → el cliente carga su tabla real. Los pasos e   */
  /* instrucciones de medición sí son finales.                                  */
  function openSizeGuide() {
    var ov = document.querySelector(".kv-pdp-sizeguide-modal-ov");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "kv-pdp-modal-ov kv-pdp-sizeguide-modal-ov";
      var SIZES = ["S/01", "S/01", "S/01", "S/01", "S/01", "S/01", "S/01", "S/01", "S/01"];
      var ROWS = [
        ["Ancho de hombros", "49"], ["Ancho de pecho", "54"], ["Ancho bajo", "54"],
        ["Largo total", "74"], ["Largo de manga", "74"]
      ];
      var thead = '<tr><th class="kv-sg-corner">Talles</th>' + SIZES.map(function (s) { return "<th>" + s + "</th>"; }).join("") + "</tr>";
      var tbody = ROWS.map(function (r) {
        return "<tr><th>" + r[0] + "</th>" + SIZES.map(function () { return "<td>" + r[1] + "</td>"; }).join("") + "</tr>";
      }).join("");
      var STEPS = [
        ["1. Ancho de Hombros", "Medir desde donde comienza el hombro recto hasta el otro hombro."],
        ["2. Ancho de Pecho", "Medir debajo de la curvatura de la manga, es decir, desde la sisa hasta el otro extremo."],
        ["3. Ancho Bajo", "Medir en la parte inferior de la prenda de extremo a otro."],
        ["4. Largo Total", "El largo total de la prenda se mide desde donde termina el ancho del cuello, es decir, desde donde comienza el hombro hacia abajo."],
        ["5. Largo de Manga", "Medir desde el inicio del hombro hasta el puño."]
      ];
      var steps = STEPS.map(function (s) {
        return '<div class="kv-sg-step"><h5 class="kv-sg-step-h">' + s[0] + '</h5><p class="kv-sg-step-t">' + s[1] + "</p></div>";
      }).join("");
      ov.innerHTML =
        '<div class="kv-pdp-modal-panel" role="dialog" aria-label="Guía de talles">' +
        '<div class="kv-pdp-modal-header"><h3 class="kv-pdp-modal-header-title">Guía de talles</h3>' +
        '<button type="button" class="kv-pdp-modal-x" aria-label="Cerrar"></button></div>' +
        '<div class="kv-pdp-modal-body">' +
        '<div class="kv-sg-table-wrap"><table class="kv-sg-table"><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table></div>" +
        '<section class="kv-sg-how"><div class="kv-sg-how-txt"><h4 class="kv-sg-how-title">Cómo medir</h4>' +
        '<p class="kv-sg-how-p">Para poder medir una prenda vas a necesitar un centímetro. Tenés que apoyar la prenda en una superficie plana. La medida se toma desde las costuras laterales.</p></div>' +
        '<img class="kv-sg-how-img" src="' + PROMO_IMG + 'sizeguide-illu.png" alt="Cómo medir una prenda" loading="lazy"></section>' +
        '<div class="kv-sg-steps">' + steps + "</div>" +
        "</div></div>";
      document.body.appendChild(ov);
      ov.addEventListener("click", function (e) {
        if (e.target === ov || e.target.closest(".kv-pdp-modal-x")) closePdpModal(ov);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) closePdpModal(ov);
      });
    }
    void ov.offsetWidth; ov.classList.add("open"); // reflow -> el estado inicial se pinta antes del slide (evita apertura brusca la 1ra vez)
    document.documentElement.classList.add("f2tn-lock");
  }

  /* ------------------------------------------------------------------ */
  /* PDP — Pop-up "Conocé tu talle" (handoff 02). A diferencia de las      */
  /* modales de ficha (panel lateral que desliza), este es un overlay      */
  /* CENTRADO que aparece con FADE (opacity 0→1, 300ms ease-in-out) sobre  */
  /* overlay #000/50%. Cierra con ✕ / click overlay / Esc; bloquea scroll. */
  /* Contenido placeholder (falta la fuente/tabla del cliente).            */
  /* ------------------------------------------------------------------ */
  function closeSizeFitModal(ov) {
    ov.classList.remove("open");
    document.documentElement.classList.remove("f2tn-lock");
  }
  function openSizeFitModal() {
    var ov = document.querySelector(".kv-sizefit-ov");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "kv-sizefit-ov";
      ov.innerHTML =
        '<div class="kv-sizefit" role="dialog" aria-label="Conocé tu talle">' +
        '<button type="button" class="kv-sizefit-close" aria-label="Cerrar"></button>' +
        '<h3 class="kv-sizefit-title">Conocé tu talle</h3>' +
        '<div class="kv-sizefit-body"><p>Próximamente vas a poder encontrar tu talle ideal desde acá.</p></div>' +
        "</div>";
      document.body.appendChild(ov);
      ov.addEventListener("click", function (e) {
        if (e.target === ov || e.target.closest(".kv-sizefit-close")) closeSizeFitModal(ov);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) closeSizeFitModal(ov);
      });
    }
    void ov.offsetWidth; ov.classList.add("open"); // reflow -> el estado inicial se pinta antes del slide (evita apertura brusca la 1ra vez)
    document.documentElement.classList.add("f2tn-lock");
  }

  /* ------------------------------------------------------------------ */
  /* PDP mobile — galería: flechas laterales + barra de progreso (Figma). */
  /* Se mantiene el Swiper nativo; agregamos las flechas (slidePrev/Next) */
  /* y una barra segmentada que sigue el slide activo.                    */
  /* ------------------------------------------------------------------ */
  function initPdpMobileGallery() {
    if (window.innerWidth >= 768) return;
    var slider = document.querySelector(".js-product-slider.swiper-container");
    if (!slider || slider.getAttribute("data-kv-mobgal") === "1") return;
    var sw = slider.swiper;
    if (!sw) return; // el swiper aún no inicializó
    slider.setAttribute("data-kv-mobgal", "1");
    var media = slider.closest(".product-images-slider") || slider.parentElement;
    media.classList.add("kv-mob-media");

    var prev = document.createElement("button"); prev.type = "button"; prev.className = "kv-mob-arrow kv-mob-prev"; prev.setAttribute("aria-label", "Anterior");
    var next = document.createElement("button"); next.type = "button"; next.className = "kv-mob-arrow kv-mob-next"; next.setAttribute("aria-label", "Siguiente");
    prev.addEventListener("click", function () { sw.slidePrev(); });
    next.addEventListener("click", function () { sw.slideNext(); });
    media.appendChild(prev); media.appendChild(next);

    var bar = document.createElement("div"); bar.className = "kv-mob-bar";
    var fill = document.createElement("div"); fill.className = "kv-mob-bar-fill";
    bar.appendChild(fill); media.appendChild(bar);
    function realCount() { return slider.querySelectorAll(".swiper-slide:not(.swiper-slide-duplicate)").length || 1; }
    function update() {
      var n = realCount();
      var idx = sw.realIndex != null ? sw.realIndex : (sw.activeIndex || 0);
      fill.style.width = (100 / n) + "%";
      fill.style.transform = "translateX(" + (idx * 100) + "%)";
    }
    sw.on("slideChange", update);
    update();
  }

  /* ------------------------------------------------------------------ */
  /* Botones "blurred" sobre imagen (slideshow/hero/banners): el cliente  */
  /* elige el COLOR desde el admin (hex normal) y acá le agregamos la      */
  /* OPACIDAD (.2 base / .3 hover) volcándolo a vars CSS. El texto se      */
  /* respeta tal cual. TN no acepta rgba ni hex-8 en el admin -> por eso   */
  /* la transparencia la pone el JS, no el cliente. Handoff: solo elige    */
  /* el color y listo. Idempotente (se re-corre por reintentos).           */
  /* ------------------------------------------------------------------ */
  function parseRGB(c) {
    if (!c) return null;
    c = ("" + c).trim();
    var m = c.match(/(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/);
    if (m) return [+m[1], +m[2], +m[3]];
    var h = c.charAt(0) === "#" ? c.slice(1) : c;
    if (/^[0-9a-fA-F]{6}$/.test(h)) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    if (/^[0-9a-fA-F]{3}$/.test(h)) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    return null;
  }
  function initBlurButtons() {
    if (document.documentElement.classList.contains("kv-preview")) return; // en el editor, botón sólido normal
    var btns = document.querySelectorAll(".section-slideshow .btn, .section-hero .btn, .section-banners .btn");
    btns.forEach(function (btn) {
      var rgb = parseRGB(btn.style.backgroundColor) || [0, 0, 0]; // color del admin (inline); default negro
      btn.style.setProperty("--kv-bbg", "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",.2)");
      btn.style.setProperty("--kv-bbg-h", "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",.3)");
      if (btn.style.color) btn.style.setProperty("--kv-btxt", btn.style.color); // texto del admin, tal cual
    });
  }

  /* Scroll lock de la ficha SIN overflow:hidden (para no romper el sticky del header e
     info). Cuando hay un modal abierto (html.f2tn-lock) en la ficha, frenamos la rueda
     y el touch del fondo; dentro del panel del modal el scroll se permite. */
  function kvBlockBgScroll(e) {
    var html = document.documentElement;
    if (!html.classList.contains("f2tn-lock")) return;
    if (!document.body || document.body.className.indexOf("template-product") === -1) return;
    var t = e.target;
    if (t && t.closest && t.closest(".kv-pdp-modal-panel, .f2tn-search-panel")) return; // permitir scroll dentro del panel
    e.preventDefault();
  }

  function init() {
    var adbarClosed = initAdbarClose();
    window.addEventListener("wheel", kvBlockBgScroll, { passive: false });
    window.addEventListener("touchmove", kvBlockBgScroll, { passive: false });
    if (!adbarClosed) initTopbarCarousel();
    initStickyHeader();
    initFacilitatorsSlider();
    initNewCollectionTabs();
    initFooterText();
    initBannerReveal();
    initBlurButtons();
    // reintentos: algunas secciones (slideshows) renderizan/clonan su contenido despues
    [600, 1500, 3000].forEach(function (ms) { setTimeout(initBannerReveal, ms); setTimeout(initBlurButtons, ms); });
    initSearchEmpty();
    initSeoHeadings();
    initSearchPanel();
    initPromoModal();
    initOffersModal();
    initMenuIcon();
    initMenuClickNav();
    initMenuVerTodo();
    initMobileMenuLogo();
    initPdp();
    initPdpTabs();
    initPdpSameDay();
    [400, 1200].forEach(function (ms) { setTimeout(initPdpSameDay, ms); }); // los tabs se inyectan por JS
    initPdpSizeLinks();
    initPdpBtnText();
    initPdpBadges();
    [500, 1500].forEach(function (ms) { setTimeout(initPdpBadges, ms); }); // los labels nativos pueden renderizar tarde
    initPdpSizeGate();
    initPdpOutOfStock();
    [500, 1500].forEach(function (ms) { setTimeout(initPdpSizeGate, ms); setTimeout(initPdpOutOfStock, ms); }); // el form de talles puede renderizar tarde
    initPdpGallery();
    initPdpZoom();
    initPdpMobileGallery();
    setTimeout(function () { initPdpGallery(); initPdpZoom(); initPdpMobileGallery(); }, 900); // el Swiper puede inicializar después del DOMContentLoaded

    fetch(MAP_URL, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (map) {
        if (!map) return;
        pdpMap = map;
        byId = buildIndex(map);
        renderAll(document);
        observe();
        initPdpColors();
      })
      .catch(function () { /* silencioso: sin mapa, no hay swatches */ });

    fetch(IMAGES_URL, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.images) { pdpImagesById = data.images; setupQuickshopGallery(data.images); initPdpColors(); }
      })
      .catch(function () { /* silencioso: sin mapa de imágenes, queda la nativa */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ============================================================================
   Kevingston — Carrito desplegable: "Medios de envío" como acordeón colapsable
   (Figma 2305:22768). Inyecta un header propio + chevron; colapsado por defecto.
   Se re-inicializa cuando el carrito ajax se re-renderiza.
   ==========================================================================*/
(function () {
  function initEnvios() {
    var list = document.querySelectorAll('#modal-cart .shipping-calculator:not([data-kv-envios])');
    for (var i = 0; i < list.length; i++) {
      (function (el) {
        el.setAttribute('data-kv-envios', '1');
        var head = document.createElement('button');
        head.type = 'button';
        head.className = 'kv-envios-header';
        head.setAttribute('aria-expanded', 'false');
        head.innerHTML = '<span>Medios de envío</span><span class="kv-envios-chev" aria-hidden="true"></span>';
        el.insertBefore(head, el.firstChild);
        head.addEventListener('click', function () {
          var open = el.classList.toggle('kv-open');
          head.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      })(list[i]);
    }
  }
  function fixEmptyText() {
    var a = document.querySelector('#modal-cart .js-empty-ajax-cart .alert');
    if (a && a.textContent.trim() !== 'El carrito de compras está vacío') {
      a.textContent = 'El carrito de compras está vacío';
    }
  }

  /* Variante "(Talle, Color)" nativa → "Color: X / Talle: Y" (Figma).
     Detecta el color contra los nombres del color-map.json de la tienda. */
  var COLOR_NAMES = null;
  function loadColors(cb) {
    if (COLOR_NAMES) { cb(); return; }
    fetch('https://powecommerce.github.io/kevingston-css/color-map.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (map) {
        COLOR_NAMES = new Set();
        if (map) {
          Object.keys(map).forEach(function (k) {
            var g = map[k]; if (!g || !g.forEach) return;
            g.forEach(function (v) { if (v && v.name) COLOR_NAMES.add(String(v.name).trim().toLowerCase()); });
          });
        }
        cb();
      })
      .catch(function () { COLOR_NAMES = new Set(); cb(); });
  }
  function fmtVariant(raw) {
    var parts = raw.trim().replace(/^\(|\)$/g, '').split(/\s*[\/,]\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length !== 2) return raw; // sólo manejamos el caso "A, B" (talle + color)
    var a = parts[0], b = parts[1], color, talle;
    if (COLOR_NAMES && COLOR_NAMES.has(a.toLowerCase())) { color = a; talle = b; }
    else if (COLOR_NAMES && COLOR_NAMES.has(b.toLowerCase())) { color = b; talle = a; }
    else { talle = a; color = b; } // fallback posicional: el nativo es "(Talle, Color)"
    return 'Color: ' + color + ' / Talle: ' + talle;
  }
  function fixVariants() {
    loadColors(function () {
      var els = document.querySelectorAll('#modal-cart .cart-item-variant:not([data-kv-var]),#shoppingCartPage .cart-item-variant:not([data-kv-var])');
      for (var i = 0; i < els.length; i++) {
        var el = els[i]; el.setAttribute('data-kv-var', '1');
        var t = el.textContent.trim(); if (!t) continue;
        el.textContent = fmtVariant(t);
      }
    });
  }
  /* Mover "Medios de envío" entre subtotal y total (orden Figma) */
  function moveMedios() {
    var totalC = document.querySelector('#modal-cart .js-cart-total-container');
    var medios = document.querySelector('#modal-cart .cart-fulfillment-info');
    if (totalC && medios && totalC.parentNode && medios.nextElementSibling !== totalC) {
      medios.classList.add('kv-moved');
      totalC.parentNode.insertBefore(medios, totalC);
    }
  }
  /* Subtotal nativo "Subtotal (sin envío):" → "Subtotal: (sin envío)" (Figma) */
  function fixSubtotalLabel() {
    var lbls = document.querySelectorAll('#modal-cart .cart-totals-subtotal>span:first-child,#shoppingCartPage .cart-totals-subtotal>span:first-child');
    for (var i = 0; i < lbls.length; i++) {
      var lbl = lbls[i];
      var want = /\(|sin env[ií]o/i.test(lbl.textContent) ? 'Subtotal: (sin envío)' : 'Subtotal:';
      if (lbl.textContent.trim() !== want) lbl.textContent = want;
    }
  }
  /* "Ver más productos" → "Seguir Comprando" (Figma) */
  function fixContinueLink() {
    var a = document.querySelector('#modal-cart .cart-continue-shopping .btn-link');
    if (a && a.textContent.trim() !== 'Seguir Comprando') a.textContent = 'Seguir Comprando';
  }
  /* Box "ATENCIÓN" (MODO) entre la fila del CP y los resultados; solo con resultados */
  function injectModoNotice() {
    var sc = document.querySelector('#modal-cart .shipping-calculator');
    if (!sc) return;
    var resp = sc.querySelector('.js-shipping-calculator-response');
    if (!resp) return;
    var notice = sc.querySelector('.kv-modo-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'kv-modo-notice';
      notice.textContent = 'ATENCIÓN: Las promociones bancarias con tarjetas de crédito o débito que incluyen reintegros se aplican seleccionando la opción MODO al momento de realizar el pago';
      resp.parentNode.insertBefore(notice, resp);
    }
    var want = resp.children.length > 0 ? '' : 'none';
    if (notice.style.display !== want) notice.style.display = want;
  }
  /* Textos de la página /comprar para matchear el Figma (no editables por traducción en compose) */
  function fixCartPageTexts() {
    var inp = document.querySelector('#shoppingCartPage .coupon-input .js-coupon-input');
    if (inp && inp.getAttribute('placeholder') !== 'Ingresa el código') inp.setAttribute('placeholder', 'Ingresa el código');
    var apply = document.querySelector('#shoppingCartPage .coupon-input .js-apply-coupon-idle');
    if (apply && apply.textContent.trim() !== 'Ingresar') apply.textContent = 'Ingresar';
    var lbl = document.querySelector('#shoppingCartPage .price-without-taxes-cart-container .price-without-taxes-label');
    if (lbl && lbl.textContent.trim() !== 'Subtotal sin impuestos nacionales') lbl.textContent = 'Subtotal sin impuestos nacionales';
  }
  /* "Precio sin impuestos nacionales $X" por item (Figma). Se calcula con el ratio real
     sin-impuestos/subtotal del carrito (IVA uniforme) → exacto, no aproximado. */
  function kvParseMoney(s) { return parseFloat(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0; }
  function kvFmtMoney(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }
  function fixItemTaxLines() {
    var page = document.getElementById('shoppingCartPage'); if (!page) return;
    var subEl = page.querySelector('.js-cart-subtotal[data-priceraw]');
    var wtEl = page.querySelector('.js-price-without-taxes-cart');
    if (!subEl || !wtEl) return;
    var sub = parseFloat(subEl.getAttribute('data-priceraw')) / 100; // priceraw en centavos
    var wt = kvParseMoney(wtEl.textContent);
    if (!(sub > 0) || !(wt > 0)) return;
    var ratio = wt / sub;
    if (!(ratio > 0.4) || !(ratio < 1)) return; // sanidad
    var items = page.querySelectorAll('.cart-page-item');
    for (var i = 0; i < items.length; i++) {
      var info = items[i].querySelector('.cart-item-info-container');
      if (!info || info.querySelector('.kv-item-notax')) continue;
      var priceEl = items[i].querySelector('.js-cart-item-unit-price') || items[i].querySelector('.js-cart-item-subtotal');
      var base = priceEl ? kvParseMoney(priceEl.textContent) : 0;
      if (!(base > 0)) continue;
      var d = document.createElement('div');
      d.className = 'kv-item-notax';
      d.innerHTML = '<span class="kv-notax-lbl">Precio sin impuestos nacionales</span> <span class="kv-notax-val">' + kvFmtMoney(base * ratio) + '</span>';
      info.appendChild(d);
    }
  }
  function applyCart() {
    initEnvios(); fixEmptyText(); fixVariants();
    moveMedios(); fixSubtotalLabel(); fixContinueLink();
    injectModoNotice(); fixCartPageTexts(); fixItemTaxLines();
  }
  function boot() {
    applyCart();
    var modal = document.getElementById('modal-cart');
    if (modal && !modal.__kvEnviosObs) {
      modal.__kvEnviosObs = new MutationObserver(function () { applyCart(); });
      modal.__kvEnviosObs.observe(modal, { childList: true, subtree: true });
    }
    var page = document.getElementById('shoppingCartPage');
    if (page && !page.__kvObs) {
      page.__kvObs = new MutationObserver(function () { applyCart(); });
      page.__kvObs.observe(page, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/*
 * Kevingston — Override del mensaje de error de cupón.
 * La traducción nativa "Cupón inválido o no aplicable." no es editable por
 * compose (vive en translations/*.json = fork). store.js inyecta ese texto en
 * .js-coupon-error desde el data-error-text del contenedor, así que reescribimos
 * ambos y observamos el carrito por si el drawer/página se re-renderiza (ajax).
 */
(function () {
  var NEW = "El Código de Descuento ingresado no es válido.";
  var RX = /cup[oó]n inv[aá]lido|no aplicable/i;
  function fix() {
    var conts = document.querySelectorAll(
      '[data-component="cart-coupon.container"][data-error-text], .coupon-input[data-error-text]'
    );
    for (var i = 0; i < conts.length; i++) {
      var t = conts[i].getAttribute("data-error-text");
      if (t && RX.test(t)) conts[i].setAttribute("data-error-text", NEW);
    }
    var errs = document.querySelectorAll(".js-coupon-error");
    for (var j = 0; j < errs.length; j++) {
      if (RX.test(errs[j].textContent || "")) errs[j].textContent = NEW;
    }
  }
  function boot() {
    fix();
    ["modal-cart", "shoppingCartPage"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.__kvCouponObs) {
        el.__kvCouponObs = new MutationObserver(fix);
        el.__kvCouponObs.observe(el, { childList: true, subtree: true, characterData: true });
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/*
 * Kevingston — Modales de autenticación (drawer lateral): login / registro / reset.
 * - El ícono de cuenta (deslogueado) y cualquier link a las URLs de cuenta abren el modal
 *   correspondiente en vez de navegar. Los cross-links entre modales se rutean por su href.
 * - Si el usuario está logueado, los snippets no se renderizan y los links navegan normal.
 */
(function () {
  function norm(u) {
    try { return new URL(u, location.href).pathname.replace(/\/+$/, ""); }
    catch (e) { return (u || "").replace(/\/+$/, ""); }
  }
  function openModal(id) {
    var o = document.getElementById(id);
    if (!o) return;
    // cerrar cualquier otro abierto sin restaurar el scroll (transición entre modales)
    var opened = document.querySelectorAll(".f2tn-auth-ov.f2tn-open");
    for (var i = 0; i < opened.length; i++) {
      opened[i].classList.remove("f2tn-open");
      opened[i].setAttribute("aria-hidden", "true");
    }
    o.classList.add("f2tn-open");
    o.setAttribute("aria-hidden", "false");
    var sw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (sw > 0) document.body.style.paddingRight = sw + "px";
    setTimeout(function () {
      var inp = o.querySelector('input:not([type="hidden"])');
      if (inp) inp.focus();
    }, 120);
  }
  function closeAll() {
    var opened = document.querySelectorAll(".f2tn-auth-ov.f2tn-open");
    for (var i = 0; i < opened.length; i++) {
      opened[i].classList.remove("f2tn-open");
      opened[i].setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }
  function boot() {
    if (!document.querySelector(".f2tn-auth-ov")) return; // logueado => sin modales

    // Capturar las URLs de cada flujo desde los links renderizados
    var icon = document.querySelector('.header-account a.header-icon');
    var regLink = document.querySelector('#kv-login-modal .form-login-help-link');
    var resLink = document.querySelector('#kv-login-modal .login-password-help-link');
    var loginUrl = icon ? norm(icon.getAttribute("href")) : "";
    var registerUrl = regLink ? norm(regLink.getAttribute("href")) : "";
    var resetUrl = resLink ? norm(resLink.getAttribute("href")) : "";

    function idFor(href) {
      var p = norm(href);
      if (loginUrl && p === loginUrl) return "kv-login-modal";
      if (registerUrl && p === registerUrl) return "kv-register-modal";
      if (resetUrl && p === resetUrl) return "kv-reset-modal";
      return null;
    }

    // Apertura / cross-links (captura para ganarle a otros handlers)
    document.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      var id = idFor(a.getAttribute("href"));
      if (id && document.getElementById(id)) {
        e.preventDefault();
        e.stopPropagation();
        openModal(id);
      }
    }, true);

    // Cierre: X, click en overlay, Escape
    document.addEventListener("click", function (e) {
      if (e.target.classList && e.target.classList.contains("f2tn-auth-ov")) closeAll();
      else if (e.target.closest && e.target.closest(".f2tn-auth-close")) closeAll();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.querySelector(".f2tn-auth-ov.f2tn-open")) closeAll();
    });

    // AJAX login/registro: el error NUNCA navega a /account/*, se resuelve dentro del modal.
    // Capture phase + stopImmediatePropagation para correr ANTES del submit de store.js.
    document.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form || !form.closest(".f2tn-auth-ov")) return;
      var isLogin = form.id === "login-form";
      var isRegister = form.id === "register-form";
      var isReset = form.id === "reset-form";
      if (!isLogin && !isRegister && !isReset) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var modal = form.closest(".f2tn-auth-ov");
      var btn = form.querySelector('button[type="submit"]');
      var action = form.getAttribute("action") || location.pathname;
      var stayRx = isLogin ? /\/account\/login/ : (isRegister ? /\/account\/register/ : /\/account\/reset/);
      var emailEl = form.querySelector('[name="email"]');
      var regEmail = emailEl ? emailEl.value : "";

      if (isLogin) {
        var errBox = modal.querySelector(".js-login-error");
        if (errBox) errBox.style.display = "none";
      }

      // Registro: validación client-side (reemplaza la de TN que salteamos) para no
      // postear datos inválidos ni crear cuentas con contraseñas que no coinciden.
      if (isRegister) {
        var pass = form.querySelector('[name="password"]');
        var conf = form.querySelector('[name="password_confirmation"]');
        if (conf && pass) {
          conf.setCustomValidity(conf.value !== pass.value ? "Las contraseñas no coinciden" : "");
        }
        if (typeof form.checkValidity === "function" && !form.checkValidity()) {
          if (typeof form.reportValidity === "function") form.reportValidity();
          return;
        }
      }

      if (btn) btn.disabled = true;

      fetch(action, {
        method: "POST",
        body: new URLSearchParams(new FormData(form)),
        redirect: "follow",
        credentials: "same-origin",
      })
        .then(function (res) {
          // Éxito: TN redirige fuera de /account/{login,register} → navegamos ahí.
          if (!stayRx.test(res.url)) {
            window.location.href = res.url || "/account";
            return null;
          }
          return res.text(); // sigue en la misma página: error o validación pendiente
        })
        .then(function (html) {
          if (html === null) return; // redirección de éxito en curso
          var esc = function (s) { return (s || "").replace(/[&<>"]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); };
          var mailSvg = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M29.3344 9.334L17.3454 16.9692C16.9386 17.2055 16.4765 17.3299 16.006 17.3299C15.5355 17.3299 15.0734 17.2055 14.6666 16.9692L2.6656 9.334M5.33248 5.3344H26.6675C28.1404 5.3344 29.3344 6.52819 29.3344 8.0008V23.9992C29.3344 25.4718 28.1404 26.6656 26.6675 26.6656H5.33248C3.8596 26.6656 2.6656 25.4718 2.6656 23.9992V8.0008C2.6656 6.52819 3.8596 5.3344 5.33248 5.3344Z" stroke="#1D1D1D" stroke-width="1.5" stroke-linecap="round"/></svg>';
          if (isLogin) {
            if (btn) btn.disabled = false;
            var eb = modal.querySelector(".js-login-error");
            if (eb) eb.style.display = "flex";
            return;
          }
          if (isReset) {
            var docR = new DOMParser().parseFromString(html, "text/html");
            var bodyR = modal.querySelector(".kv-login-body");
            if (docR.querySelector(".alert-success") && bodyR) {
              // Email enviado → card de confirmación (mismo estilo que registro)
              bodyR.innerHTML =
                '<div class="kv-register-card">' +
                  '<span class="kv-register-card-icon">' + mailSvg + '</span>' +
                  '<div class="kv-register-card-title">¡Revisá tu email!</div>' +
                  '<div class="kv-register-card-text">Te enviamos un link a <span class="kv-register-email">' + esc(regEmail) + '</span> para restablecer tu contraseña.</div>' +
                '</div>' +
                '<div class="kv-register-links">' +
                  '<div class="kv-register-linkrow">¿Todavía no lo recibiste? <button type="button" class="js-resend-validation-link btn-link kv-register-link" data-customer-email="' + esc(regEmail) + '">Enviar Link de nuevo</button></div>' +
                  '<div class="kv-register-linkrow">¿Ya tenés una cuenta? <a href="' + (loginUrl || "/account/login") + '" class="btn-link kv-register-link">Iniciá Sesión</a></div>' +
                '</div>';
            } else {
              // Email no encontrado / error → mostrar mensaje sin navegar
              if (btn) btn.disabled = false;
              var grp = form.querySelector(".form-group");
              if (grp && !form.querySelector(".js-reset-error")) {
                var errR = document.createElement("div");
                errR.className = "kv-login-error js-reset-error";
                errR.style.display = "flex";
                errR.innerHTML = '<span class="kv-login-error-txt">No encontramos una cuenta con ese email.</span>';
                grp.parentNode.insertBefore(errR, grp.nextSibling);
              }
            }
            return;
          }
          // REGISTRO: re-render de lo que devolvió TN (errores inline o validación pendiente)
          var doc = new DOMParser().parseFromString(html, "text/html");
          var newForm = doc.querySelector("#register-form");
          var body = modal.querySelector(".kv-login-body");
          if (newForm) {
            var oldForm = modal.querySelector("#register-form");
            if (oldForm) { oldForm.parentNode.replaceChild(document.importNode(newForm, true), oldForm); }
            else if (btn) btn.disabled = false;
          } else if (doc.querySelector(".js-account-validation-pending") && body) {
            // Cuenta creada, validación por email pendiente → vista custom (Figma 4032-32587)
            body.innerHTML =
              '<p class="kv-login-desc">Comprá más rápido y llevá el control de tus pedidos, ¡en un solo lugar!</p>' +
              '<div class="kv-register-card">' +
                '<span class="kv-register-card-icon">' + mailSvg + '</span>' +
                '<div class="kv-register-card-title">¡Estás a un paso de crear tu cuenta!</div>' +
                '<div class="kv-register-card-text">Te enviamos un link a <span class="kv-register-email">' + esc(regEmail) + '</span> para que valides tu email.</div>' +
              '</div>' +
              '<div class="kv-register-links">' +
                '<div class="kv-register-linkrow">¿Todavía no lo recibiste? <button type="button" class="js-resend-validation-link btn-link kv-register-link" data-customer-email="' + esc(regEmail) + '">Enviar Link de nuevo</button></div>' +
                '<div class="kv-register-linkrow">¿Ya tenés una cuenta? <a href="' + (loginUrl || "/account/login") + '" class="btn-link kv-register-link">Iniciá Sesión</a></div>' +
              '</div>';
          } else {
            window.location.href = "/account";
          }
        })
        .catch(function () {
          if (btn) btn.disabled = false;
          if (isLogin) {
            var eb2 = modal.querySelector(".js-login-error");
            if (eb2) eb2.style.display = "flex";
          }
        });
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/*
 * Kevingston — Página de Locales (sección main-locales).
 * Lee locales.json (data-json de .kv-locales), renderiza la lista, filtra por búsqueda
 * y actualiza el mapa embed al hacer clic en "Ver en el mapa". Cuando haya Maps JS API
 * key se puede reemplazar el iframe por un mapa con pines.
 */
(function () {
  var root = document.querySelector(".kv-locales");
  if (!root) return;
  var listEl = root.querySelector(".js-kv-locales-list");
  var mapEl = root.querySelector(".js-kv-locales-map");
  var searchEl = root.querySelector(".js-kv-locales-search");
  var url = root.getAttribute("data-json");
  var all = [];
  function esc(s) { return (s || "").replace(/[&<>"]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function queryFor(l) { return l.mapQuery || (l.lat && l.lng ? l.lat + "," + l.lng : ((l.address1 || "") + " " + (l.address2 || ""))); }
  function mapSrc(q) { return "https://www.google.com/maps?q=" + encodeURIComponent(q) + "&output=embed"; }
  function render(items) {
    if (!items.length) { listEl.innerHTML = '<div class="kv-locales-empty">No encontramos locales.</div>'; return; }
    listEl.innerHTML = items.map(function (l) {
      var phone = l.phone ? '<a href="tel:' + esc((l.phone + "").replace(/\s/g, "")) + '">' + esc(l.phone) + "</a>" : "";
      return '<div class="kv-locales-item" role="listitem">' +
        '<div class="kv-locales-item-name">' + esc(l.name) + "</div>" +
        '<div class="kv-locales-item-details">' +
          (l.address1 ? "<span>" + esc(l.address1) + "</span>" : "") +
          (l.address2 ? "<span>" + esc(l.address2) + "</span>" : "") +
          phone +
          (l.hours ? "<span>" + esc(l.hours) + "</span>" : "") +
        "</div>" +
        '<button type="button" class="kv-locales-item-link" data-q="' + esc(queryFor(l)) + '">Ver en el mapa</button>' +
      "</div>";
    }).join("");
  }
  if (listEl) listEl.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".kv-locales-item-link") : null;
    if (!btn || !mapEl) return;
    mapEl.src = mapSrc(btn.getAttribute("data-q"));
    var wrap = root.querySelector(".kv-locales-mapwrap");
    if (wrap) wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  if (searchEl) searchEl.addEventListener("input", function () {
    var q = this.value.trim().toLowerCase();
    render(!q ? all : all.filter(function (l) {
      return (((l.name || "") + " " + (l.address1 || "") + " " + (l.address2 || "")).toLowerCase().indexOf(q) >= 0);
    }));
  });
  if (!url) return;
  fetch(url, { cache: "no-cache" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      all = (data && data.locales) || [];
      render(all);
      if (all.length && mapEl) mapEl.src = mapSrc(queryFor(all[0]));
    })
    .catch(function () { if (listEl) listEl.innerHTML = '<div class="kv-locales-empty">No se pudieron cargar los locales.</div>'; });
})();

/* ============================================================
   Forms tipo contacto (Libro de quejas /reclamos-sugerencias + Contacto)
   Genérico, dirigido por data-attributes:
   - Puebla selects .js-kv-options desde data-kv-options (una opción por línea).
   - Al enviar (fase de captura, ANTES de store.js) pliega los campos marcados
     con data-kv-fold="Etiqueta" dentro del textarea marcado con data-kv-message,
     porque TN solo manda name/email/phone/message por mail.
   NO hace preventDefault: el envío real + reCAPTCHA lo maneja store.js vía la
   clase js-winnie-pooh-form. Va acá (no inline) porque TN escapea el <script>.
   ============================================================ */
(function () {
  function populate(sel) {
    var raw = sel.getAttribute('data-kv-options') || '';
    raw.split(/\r?\n/).forEach(function (line) {
      var v = line.trim();
      if (!v) return;
      var op = document.createElement('option');
      op.value = v;
      op.textContent = v;
      sel.appendChild(op);
    });
  }

  function bindForm(form) {
    if (form.dataset.kvBound) return;
    form.dataset.kvBound = '1';

    form.querySelectorAll('.js-kv-options').forEach(populate);

    form.addEventListener('submit', function () {
      var msg = form.querySelector('[data-kv-message]');
      if (!msg || msg.dataset.kvFolded) return;
      var lines = [];
      form.querySelectorAll('[data-kv-fold]').forEach(function (el) {
        lines.push(el.getAttribute('data-kv-fold') + ': ' + (el.value || ''));
      });
      var userMsg = (msg.value || '').trim();
      msg.value =
        (lines.length ? lines.join('\n') + '\n--------------------------------\n' : '') +
        (userMsg ? ('Mensaje:\n' + userMsg) : 'Mensaje: (sin comentario)');
      msg.dataset.kvFolded = '1';
    }, true);
  }

  function initKvForms() {
    document.querySelectorAll('form.js-kv-cform').forEach(bindForm);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initKvForms);
  else initKvForms();
})();

/* ============================================================
   About Us — animaciones (Figma spec)
   1) Cascada de textos del primer bloque (Nuestra Historia) al CARGAR.
   2) Cards Misión/Visión/Valores: fade en cascada al entrar en viewport (IO), 1 sola vez.
   opacity 0->1, 300ms ease-in-out, 100ms stagger. Los estados los define el CSS (.kv-in).
   ============================================================ */
(function () {
  function initAbout() {
    var about = document.querySelector('.kv-about');
    if (!about || about.dataset.kvAnim) return;
    about.dataset.kvAnim = '1';

    // (1) Primer bloque: cascada al cargar
    var first = document.querySelectorAll('.kv-about-hist-body .kv-anim');
    first.forEach(function (el, i) {
      setTimeout(function () { el.classList.add('kv-in'); }, 60 + i * 100);
    });

    // (2) Cards al entrar en viewport
    var org = document.querySelector('.kv-about-orgullo');
    var cards = document.querySelectorAll('.kv-about-card');
    if (org && cards.length) {
      org.classList.add('kv-io'); // recién ahora oculta las cards (evita que queden invisibles si el JS falla)
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries, obs) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              cards.forEach(function (c, i) {
                setTimeout(function () { c.classList.add('kv-in'); }, i * 100);
              });
              obs.disconnect();
            }
          });
        }, { threshold: 0.25 });
        io.observe(org);
      } else {
        cards.forEach(function (c) { c.classList.add('kv-in'); });
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAbout);
  else initAbout();
})();

/* ============================================================
   Promociones — filtro por día + flip "Ver Condiciones" + carrusel
   ============================================================ */
(function () {
  function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function initPromos() {
    var root = document.querySelector('.kv-promos');
    if (!root || root.dataset.kvInit) return;
    root.dataset.kvInit = '1';

    // Filtro por día
    var tabs = root.querySelectorAll('.kv-promo-tab');
    var cards = root.querySelectorAll('.kv-promo-card');
    var empty = root.querySelector('.js-kv-promos-empty');
    function applyFilter(day) {
      var shown = 0;
      cards.forEach(function (card) {
        var days = norm(card.getAttribute('data-days'));
        var match = day === 'all' || days.indexOf('todos') !== -1 || days.indexOf(day) !== -1;
        card.style.display = match ? '' : 'none';
        if (match) { shown++; } else { card.classList.remove('is-open'); }
      });
      if (empty) empty.hidden = shown !== 0;
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        applyFilter(tab.getAttribute('data-day'));
      });
    });

    // Flip "Ver Condiciones" / cerrar
    root.querySelectorAll('.js-kv-promo-more').forEach(function (btn) {
      btn.addEventListener('click', function () { var c = btn.closest('.kv-promo-card'); if (c) c.classList.add('is-open'); });
    });
    root.querySelectorAll('.js-kv-promo-close').forEach(function (btn) {
      btn.addEventListener('click', function () { var c = btn.closest('.kv-promo-card'); if (c) c.classList.remove('is-open'); });
    });

    // Carrusel final
    var carousel = root.querySelector('.js-kv-promos-carousel');
    if (carousel) {
      var track = carousel.querySelector('.js-kv-promos-track');
      var n = track ? track.children.length : 0;
      var idx = 0;
      var dotsWrap = carousel.querySelector('.js-kv-promos-dots');
      var dots = [];
      if (n <= 1) { carousel.setAttribute('data-single', '1'); }
      if (dotsWrap && n > 1) {
        for (var i = 0; i < n; i++) {
          var d = document.createElement('button');
          d.type = 'button'; d.className = 'kv-promos-dot'; d.setAttribute('aria-label', 'Slide ' + (i + 1));
          (function (k) { d.addEventListener('click', function () { go(k); }); })(i);
          dotsWrap.appendChild(d); dots.push(d);
        }
      }
      function go(k) {
        idx = (k + n) % n;
        if (track) track.style.transform = 'translateX(' + (-idx * 100) + '%)';
        dots.forEach(function (d, j) { d.classList.toggle('is-active', j === idx); });
      }
      var prev = carousel.querySelector('.js-kv-promos-prev');
      var next = carousel.querySelector('.js-kv-promos-next');
      if (prev) prev.addEventListener('click', function () { go(idx - 1); });
      if (next) next.addEventListener('click', function () { go(idx + 1); });
      if (n) go(0);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPromos);
  else initPromos();
})();

/* ============================================================
   Sección de Ayuda — switch de categorías (el acordeón es <details> nativo)
   ============================================================ */
(function () {
  function initAyuda() {
    var root = document.querySelector('.kv-ayuda');
    if (!root || root.dataset.kvInit) return;
    root.dataset.kvInit = '1';
    var btns = root.querySelectorAll('.js-kv-ayuda-cat');
    var panels = root.querySelectorAll('.kv-ayuda-panel');
    function activate(targetId) {
      btns.forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-target') === targetId); });
      panels.forEach(function (p) { p.classList.toggle('is-active', p.id === targetId); });
      // Si el panel embebe el mapa de locales y estaba oculto, recargar el iframe (Google embed no
      // renderiza en display:none → queda en blanco). Se recarga una sola vez al mostrarse.
      var active = root.querySelector('.kv-ayuda-panel.is-active');
      if (active) {
        var map = active.querySelector('.js-kv-locales-map');
        if (map && !map.dataset.kvShown) { map.dataset.kvShown = '1'; setTimeout(function () { map.src = map.src; }, 60); }
      }
    }
    btns.forEach(function (b) {
      b.addEventListener('click', function () { activate(b.getAttribute('data-target')); });
    });
    if (btns.length) activate(btns[0].getAttribute('data-target'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAyuda);
  else initAyuda();
})();
