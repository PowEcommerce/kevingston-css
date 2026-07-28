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
