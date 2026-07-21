#!/usr/bin/env node
/*
 * Genera color-map.json para el color picker de Kevingston.
 *
 * Lee productos de la API de Tiendanube, agrupa por los primeros 5 dígitos del
 * SKU y arma { groups: { "<sku5>": [ {id,url,color,name} ] } }.
 *
 * Credenciales: tools/.tn-secret.json (gitignoreado) =>
 *   { "store_id": "7669516", "access_token": "xxxxx" }
 * o variables de entorno TN_STORE_ID / TN_ACCESS_TOKEN.
 *
 * Uso:
 *   node tools/gen-color-map.js --probe      # muestra la forma real de 1-2 productos
 *   node tools/gen-color-map.js              # genera ../color-map.json
 */
"use strict";
const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.tiendanube.com/v1";
const UA = "Kevingston Color Map Generator (dashboard@pow.la)";
const OUT = path.join(__dirname, "..", "color-map.json");

function loadCreds() {
  let store = process.env.TN_STORE_ID;
  let token = process.env.TN_ACCESS_TOKEN;
  const secretPath = path.join(__dirname, ".tn-secret.json");
  if ((!store || !token) && fs.existsSync(secretPath)) {
    const s = JSON.parse(fs.readFileSync(secretPath, "utf8"));
    store = store || s.store_id || s.user_id;
    token = token || s.access_token;
  }
  if (!store || !token) {
    console.error("Faltan credenciales. Creá tools/.tn-secret.json con { store_id, access_token }.");
    process.exit(1);
  }
  return { store: String(store), token: String(token) };
}

async function apiGet(store, token, pathAndQuery) {
  const res = await fetch(`${API_BASE}/${store}${pathAndQuery}`, {
    headers: {
      "Authentication": `bearer ${token}`,
      "User-Agent": UA,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} en ${pathAndQuery}: ${body.slice(0, 300)}`);
  }
  return { data: await res.json(), headers: res.headers };
}

// Trae TODOS los productos siguiendo el header Link (paginación de TN).
async function fetchAllProducts(store, token) {
  const all = [];
  let page = 1;
  const perPage = 200;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data } = await apiGet(store, token, `/products?per_page=${perPage}&page=${page}&fields=id,name,handle,canonical_url,variants,attributes,images`);
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < perPage) break;
    page++;
    if (page > 100) break; // guardarraíl
  }
  return all;
}

/* ------- helpers de extracción (tolerantes a la forma real) ------- */
function firstLangValue(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    // { es: "...", pt: "..." } => primer valor no vacío
    for (const k of Object.keys(v)) if (v[k]) return v[k];
  }
  return null;
}

function productSku(p) {
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) if (v && v.sku) return String(v.sku).trim();
  }
  return null;
}

function productUrl(p) {
  const canon = firstLangValue(p.canonical_url) || firstLangValue(p.permalink);
  if (canon) return canon.replace(/^https?:\/\/[^/]+/, ""); // relativo
  const handle = firstLangValue(p.handle);
  return handle ? `/${handle}` : null;
}

// Nombre de color: primero busca atributo Color/Cor en la variante; si no, null.
function productColorName(p) {
  const attrs = Array.isArray(p.attributes) ? p.attributes.map(firstLangValue) : [];
  const colorIdx = attrs.findIndex((a) => a && /^(color|cor)$/i.test(a));
  if (colorIdx >= 0 && Array.isArray(p.variants)) {
    for (const v of p.variants) {
      const val = v && Array.isArray(v.values) ? firstLangValue(v.values[colorIdx]) : null;
      if (val) return val;
    }
  }
  return null;
}

// Diccionario nombre-de-color -> hex (opcional). tools/color-names.json =>
// { "azul marino": "#1B2A4A", "rojo": "#B12A2A", ... } (claves case-insensitive).
function loadColorDict() {
  const p = path.join(__dirname, "color-names.json");
  if (!fs.existsSync(p)) return {};
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const norm = {};
  for (const k of Object.keys(raw)) norm[k.trim().toLowerCase()] = raw[k];
  return norm;
}
function hexFor(dict, name) {
  if (!name) return null;
  return dict[String(name).trim().toLowerCase()] || null;
}

async function probe() {
  const { store, token } = loadCreds();
  const { data } = await apiGet(store, token, `/products?per_page=2&page=1`);
  console.log("Cantidad traída:", Array.isArray(data) ? data.length : "(no array)");
  (data || []).forEach((p, i) => {
    console.log(`\n===== Producto #${i + 1} (top-level keys) =====`);
    console.log(Object.keys(p).join(", "));
    console.log("name        :", JSON.stringify(p.name));
    console.log("handle      :", JSON.stringify(p.handle));
    console.log("canonical   :", JSON.stringify(p.canonical_url));
    console.log("permalink   :", JSON.stringify(p.permalink));
    console.log("attributes  :", JSON.stringify(p.attributes));
    if (Array.isArray(p.variants) && p.variants[0]) {
      console.log("variant[0] keys:", Object.keys(p.variants[0]).join(", "));
      console.log("variant[0].sku   :", JSON.stringify(p.variants[0].sku));
      console.log("variant[0].values:", JSON.stringify(p.variants[0].values));
    }
    console.log("--- derivado por el parser actual ---");
    console.log("  sku       :", productSku(p));
    console.log("  sku5      :", (productSku(p) || "").slice(0, 5) || null);
    console.log("  url       :", productUrl(p));
    console.log("  colorName :", productColorName(p));
  });
}

async function generate() {
  const { store, token } = loadCreds();
  const dict = loadColorDict();
  const products = await fetchAllProducts(store, token);
  const groups = {};
  let skipped = 0;
  for (const p of products) {
    const sku = productSku(p);
    if (!sku || sku.length < 5) { skipped++; continue; }
    const sku5 = sku.slice(0, 5);
    const name = productColorName(p);
    (groups[sku5] = groups[sku5] || []).push({
      id: p.id,
      url: productUrl(p),
      color: hexFor(dict, name), // hex del diccionario; null si falta
      name: name || firstLangValue(p.name),
    });
  }
  // descartar grupos de 1 solo color
  const finalGroups = {};
  let kept = 0;
  for (const k of Object.keys(groups)) {
    if (groups[k].length >= 2) { finalGroups[k] = groups[k]; kept += groups[k].length; }
  }
  const out = {
    _readme: "Generado por tools/gen-color-map.js. 'color' (hex) sale del diccionario tools/color-names.json; null = falta definir.",
    version: 1,
    groups: finalGroups,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Productos: ${products.length} | sin SKU válido: ${skipped} | grupos multi-color: ${Object.keys(finalGroups).length} | items en grupos: ${kept}`);
  console.log(`Escrito: ${OUT}`);

  // Reporte de colores distintos (para armar/completar el diccionario)
  const items = Object.values(finalGroups).flat();
  const byName = {};
  for (const it of items) {
    const key = (it.name || "(sin nombre)").trim();
    byName[key] = byName[key] || { n: 0, hex: it.color };
    byName[key].n++;
  }
  const names = Object.keys(byName).sort();
  if (names.length) {
    console.log(`\nColores distintos en grupos multi-color (${names.length}):`);
    for (const nm of names) {
      const { n, hex } = byName[nm];
      console.log(`  ${hex ? hex : "??????? "}  ${nm}  (x${n})`);
    }
  }
  const faltanHex = items.filter((x) => !x.color).length;
  if (faltanHex) console.log(`\n⚠️  ${faltanHex} items sin hex — completá tools/color-names.json y volvé a correr.`);
}

const mode = process.argv[2];
(mode === "--probe" ? probe() : generate()).catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
