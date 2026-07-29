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
    var swipers = document.querySelectorAll(".js-products-list-swiper");
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
        // Desktop: 4 productos + peek del 5to (slidesPerView 4.2). Editorial NO (layout propio).
        try {
          var isEditorial = el.closest(
            "#ns-section-editorial_products, #ns-section-editorial_products_mujer"
          );
          if (!isEditorial) {
            var bp = sw.params.breakpoints;
            if (bp && bp["768"]) {
              bp["768"].slidesPerView = 4.2;
              bp["768"].slidesOffsetBefore = 32; // arranca alineado; al scrollear sangra al borde
              bp["768"].slidesOffsetAfter = 32; // al final, el ultimo producto no queda pegado al borde
            }
            if (window.innerWidth >= 768) {
              sw.params.slidesPerView = 4.2;
              sw.params.slidesOffsetBefore = 32;
              sw.params.slidesOffsetAfter = 32;
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

    function render() {
      var pid = container.getAttribute("data-product-id");
      if (!pid) return;
      if (container.getAttribute("data-kv-modal") === pid) return; // ya procesado
      container.setAttribute("data-kv-modal", pid);
      renderGallery(pid);
      renderColors(pid);
      renderInfo(pid);
      renderBadges(pid);
      // Label de precio sin impuestos -> "nacionales" (traduccion, no editable por compose)
      var taxLabel = document.querySelector(
        "#quickshop-modal .price-without-taxes-label"
      );
      if (taxLabel) taxLabel.textContent = "Precio sin impuestos nacionales";
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
  /* Banners: animacion de entrada del contenido (spec 03).              */
  /* Reveal por seccion: si esta en el viewport inicial -> delay 1600ms  */
  /* (banner principal, 03-A); si no -> IntersectionObserver (03-B).     */
  /* Una sola vez. Solo secciones con contenido de texto (no solo-imagen).*/
  /* ------------------------------------------------------------------ */
  function initBannerReveal() {
    var io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            function (entries) {
              entries.forEach(function (e) {
                if (e.isIntersecting && e.target._kvRevealFn) {
                  e.target._kvRevealFn();
                  io.unobserve(e.target);
                }
              });
            },
            { threshold: 0.15 }
          )
        : null;
    var secs = document.querySelectorAll(
      ".section-banners, .js-slideshow-container, .section-hero"
    );
    var firstBanner = true; // el primer banner con texto = "banner principal" (delay al cargar)
    for (var i = 0; i < secs.length; i++) {
      (function (sec) {
        if (sec._kvReveal) return;
        var contents = sec.querySelectorAll(".media-content");
        var hasText = false;
        for (var k = 0; k < contents.length; k++) {
          if ((contents[k].textContent || "").trim()) { hasText = true; break; }
        }
        // Solo anima los BLOQUES DE TEXTO (.media-content). Las imagenes NO animan:
        // los banners solo-imagen (facilitators, etc.) quedan estaticos.
        if (!hasText) return;
        var targets = contents;
        if (!targets.length) return;
        sec._kvReveal = true;
        for (var j = 0; j < targets.length; j++)
          targets[j].classList.add("kv-reveal");
        var reveal = function () {
          for (var m = 0; m < targets.length; m++)
            targets[m].classList.add("kv-revealed");
        };
        if (firstBanner) {
          // 03-A: SOLO el banner principal (primer bloque con texto) -> delay al cargar
          firstBanner = false;
          setTimeout(reveal, 1600);
        } else if (io) {
          // 03-B: el resto SIEMPRE por scroll (entrar al viewport). No confiar en la
          // posicion al cargar (las imagenes de arriba aun no cargaron -> layout corto).
          sec._kvRevealFn = reveal;
          io.observe(sec);
        } else {
          reveal();
        }
      })(secs[i]);
    }
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
    '<button type="button" class="f2tn-x f2tn-search-close" aria-label="Cerrar"></button>' +
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
    function open() {
      ov.classList.add("f2tn-open");
      document.body.style.overflow = "hidden";
      setTimeout(function () { if (input) input.focus(); }, 120);
    }
    function close() {
      ov.classList.remove("f2tn-open");
      document.body.style.overflow = "";
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
          for (var i = 0; i < Math.min(items.length, 6); i++) {
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
              var firstUrl = function (s) {
                return s ? s.trim().split(/[\s,]+/)[0] : "";
              };
              src =
                firstUrl(img.getAttribute("data-srcset")) ||
                img.getAttribute("data-src") ||
                firstUrl(img.getAttribute("srcset")) ||
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
      var show = function () {
        var vis = getComputedStyle(successAlert).display !== "none";
        modal.classList.toggle("kv-sub-success", vis);
        if (vis) markNewsletterDone();
      };
      new MutationObserver(show).observe(successAlert, { attributes: true, attributeFilter: ["style", "class"] });
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

    var MAX = 5;
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
    ov.classList.add("open");
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
    ov.classList.add("open");
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
    ov.classList.add("open");
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
    ov.classList.add("open");
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
    ov.classList.add("open");
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
    ov.classList.add("open");
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
    ov.classList.add("open");
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

  function init() {
    var adbarClosed = initAdbarClose();
    if (!adbarClosed) initTopbarCarousel();
    initStickyHeader();
    initFacilitatorsSlider();
    initNewCollectionTabs();
    initFooterText();
    initBannerReveal();
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
    initPdpSizeLinks();
    initPdpBtnText();
    initPdpGallery();
    initPdpMobileGallery();
    setTimeout(function () { initPdpGallery(); initPdpMobileGallery(); }, 900); // el Swiper puede inicializar después del DOMContentLoaded

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
