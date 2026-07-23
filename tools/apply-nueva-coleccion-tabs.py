#!/usr/bin/env python3
# Idempotente + GENERICO: aplica el formato de tabs Hombre/Mujer a TODAS las
# secciones product-list que tengan tabs (soporta duplicados hechos en el admin).
# Marca cada header con data-kv-role="hombre|mujer"; el CSS/JS emparejan por DOM.
# Correr desde la raiz del theme kevingston despues de cada `theme pull`.
import json, copy, collections, re

P = 'templates/pages/home.json'

# Nuevo formato: wrapper con data-kv-role + los dos tabs con data-kv-tab
TAB_H = ('<span data-kv-role="hombre">'
         '<span data-kv-tab="hombre" style="color:#000000;border-bottom:1px solid #000000;padding-bottom:2px;cursor:pointer">Hombre</span>'
         '<span data-kv-tab="mujer" style="color:#737373;margin-left:24px;cursor:pointer">Mujer</span>'
         '</span>')
TAB_M = ('<span data-kv-role="mujer">'
         '<span data-kv-tab="hombre" style="color:#737373;cursor:pointer">Hombre</span>'
         '<span data-kv-tab="mujer" style="color:#000000;border-bottom:1px solid #000000;padding-bottom:2px;margin-left:24px;cursor:pointer">Mujer</span>'
         '</span>')
MUJER_CAT = '39815676'

d = json.load(open(P, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
secs = d['sections']


def iter_blocks(blocks):
    """Recorre recursivamente los blocks (dict o list) devolviendo cada bloque."""
    items = blocks.items() if isinstance(blocks, dict) else (enumerate(blocks) if isinstance(blocks, list) else [])
    for _, bv in items:
        if isinstance(bv, dict):
            yield bv
            if isinstance(bv.get('blocks'), (dict, list)):
                yield from iter_blocks(bv['blocks'])


# 1) SEED: new_collection_1 con mobile_direction + su gemela _mujer
h = secs['new_collection_1']
hr = h['blocks']['header_row']
st = hr['settings']
if not st.get('mobile_direction_enabled'):
    ns = collections.OrderedDict()
    for k, v in st.items():
        ns[k] = v
        if k == 'direction':
            ns['mobile_direction_enabled'] = True
            ns['mobile_direction'] = 'column'
    hr['settings'] = ns

# tabs base -> TAB_H (explicito, para que funcione tambien desde un baseline sin data-kv-tab)
h['blocks']['header_row']['blocks']['tabs']['settings']['text'] = TAB_H

if 'new_collection_1_mujer' not in secs:
    m = copy.deepcopy(h)
    hrb = m['blocks'].pop('header_row'); m['blocks']['header_row_m'] = hrb
    pr = m['blocks'].pop('products'); m['blocks']['products_m'] = pr
    m['block_order'] = ['header_row_m', 'products_m']
    inner = m['blocks']['header_row_m']['blocks']
    t = inner.pop('title'); inner['title_m'] = t
    tb = inner.pop('tabs'); inner['tabs_m'] = tb
    m['blocks']['header_row_m']['block_order'] = ['title_m', 'tabs_m']
    m['blocks']['header_row_m']['blocks']['tabs_m']['settings']['text'] = TAB_M
    m['blocks']['products_m']['settings']['products_source'] = collections.OrderedDict(
        [('kind', 'category'), ('id', MUJER_CAT)])
    new = collections.OrderedDict()
    for k, v in secs.items():
        new[k] = v
        if k == 'new_collection_1':
            new['new_collection_1_mujer'] = m
    d['sections'] = secs = new
    if 'new_collection_1_mujer' not in d['order']:
        i = d['order'].index('new_collection_1')
        d['order'].insert(i + 1, 'new_collection_1_mujer')

# 1b) SEED editorial_products: gemelo Mujer. Mantiene los mismos block keys que el
# base (para reusar el CSS de layout scopeado; el CSS se extiende con :is a las 2 secciones).
if 'editorial_products' in secs:
    ed = secs['editorial_products']
    ed['blocks']['tabs_row']['blocks']['tabs']['settings']['text'] = TAB_H
    if 'editorial_products_mujer' not in secs:
        em = copy.deepcopy(ed)
        em['blocks']['tabs_row']['blocks']['tabs']['settings']['text'] = TAB_M
        em['blocks']['products']['settings']['products_source'] = collections.OrderedDict(
            [('kind', 'category'), ('id', MUJER_CAT)])
        new = collections.OrderedDict()
        for k, v in secs.items():
            new[k] = v
            if k == 'editorial_products':
                new['editorial_products_mujer'] = em
        d['sections'] = secs = new
        if 'editorial_products_mujer' not in d['order']:
            i = d['order'].index('editorial_products')
            d['order'].insert(i + 1, 'editorial_products_mujer')
    # gap texto<->boton = 24 (node 959-19537) en ambas
    for ek in ('editorial_products', 'editorial_products_mujer'):
        if ek in secs:
            secs[ek]['blocks']['editorial_text']['settings']['gap'] = 24

# 2) GENERICO: reescribir el formato de tabs en toda seccion product-list con tabs
count = 0
for k, sec in secs.items():
    if sec.get('type') != 'product-list':
        continue
    for bv in iter_blocks(sec.get('blocks', {})):
        if bv.get('type') != 'text':
            continue
        s = bv.get('settings', {})
        txt = str(s.get('text', ''))
        if 'data-kv-tab' not in txt:
            continue
        # rol = quien tiene el border-bottom (tab activo)
        if re.search(r'data-kv-tab="mujer"[^>]*border-bottom', txt):
            s['text'] = TAB_M
        else:
            s['text'] = TAB_H
        count += 1

json.dump(d, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
open(P, 'a', encoding='utf-8').write('\n')
json.load(open(P, encoding='utf-8'))  # valida
print(f'OK: {count} bloques de tabs actualizados al formato con data-kv-role. sections: {len(d["sections"])}')
