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
    var mine = false;

    function isMobile() { return window.innerWidth < 768; }

    function apply() {
      if (!isMobile() || typeof Swiper === "undefined") return;
      if (mine && container.swiper) return; // ya reconfigurado
      if (container.swiper) { try { container.swiper.destroy(true, true); } catch (e) {} }
      /* global Swiper */
      new Swiper(container, {
        slidesPerView: "auto",
        centeredSlides: true,
        spaceBetween: 16,
        loop: true,
        pagination: pag ? { el: pag, clickable: true } : false
      });
      mine = true;
    }

    // Esperar a que el theme cree su swiper (lo hace con setTimeout 0) y reconfigurar.
    var tries = 0;
    (function wait() {
      if (!isMobile()) return;
      if (container.swiper || tries > 30) { apply(); return; }
      tries++;
      setTimeout(wait, 50);
    })();

    // Al cruzar a desktop, soltar nuestra instancia para que quede el grid nativo.
    window.addEventListener("resize", function () {
      if (isMobile()) { apply(); }
      else if (mine && container.swiper) { try { container.swiper.destroy(true, true); } catch (e) {} mine = false; }
    }, { passive: true });
  }

  /* "Nueva Coleccion": tabs Hombre/Mujer que alternan dos secciones-carrusel
     (#ns-section-new_collection_1 = Hombre visible, #..._mujer = Mujer oculta).
     Al tocar un tab se muestra su seccion y se oculta la otra. Ademas cada
     carrusel se reconfigura a peek (slidesPerView:'auto', card 283px por CSS)
     en mobile, preservando el 4-up de desktop via breakpoint 768 (node 959-19494). */
  function initNewCollectionTabs() {
    var hombre = document.querySelector("#ns-section-new_collection_1");
    var mujer = document.querySelector("#ns-section-new_collection_1_mujer");
    if (!hombre) return;

    function isMobile() { return window.innerWidth < 768; }
    function swiperEl(section) { return section ? section.querySelector(".js-products-list-swiper") : null; }

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

    function show(which) {
      var showEl = which === "mujer" ? mujer : hombre;
      var hideEl = which === "mujer" ? hombre : mujer;
      if (!showEl) return;
      if (hideEl) hideEl.style.display = "none";
      showEl.style.display = "";
      // el swiper estaba oculto (0px) o sin reconfigurar: peek + update ahora que es visible
      peek(showEl);
      var c = swiperEl(showEl);
      if (c && c.swiper) { c.swiper.update(); }
    }

    // Tabs clickeables (presentes en ambas cabeceras)
    var tabs = document.querySelectorAll("#ns-section-new_collection_1 [data-kv-tab], #ns-section-new_collection_1_mujer [data-kv-tab]");
    tabs.forEach(function (el) {
      el.style.cursor = "pointer";
      el.addEventListener("click", function (e) { e.preventDefault(); show(el.getAttribute("data-kv-tab")); });
    });

    // Init: reconfigurar peek de la seccion visible (Hombre) cuando el theme cree su swiper
    var tries = 0;
    (function wait() {
      var c = swiperEl(hombre);
      if ((c && c.swiper) || tries > 30) { peek(hombre); return; }
      tries++;
      setTimeout(wait, 50);
    })();

    window.addEventListener("resize", function () {
      var visible = (mujer && getComputedStyle(mujer).display !== "none") ? mujer : hombre;
      peek(visible);
    }, { passive: true });
  }

  function init() {
    var adbarClosed = initAdbarClose();
    if (!adbarClosed) initTopbarCarousel();
    initStickyHeader();
    initFacilitatorsSlider();
    initNewCollectionTabs();

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
