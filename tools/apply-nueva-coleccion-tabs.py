#!/usr/bin/env python3
# Idempotente: reaplica la estructura de tabs Hombre/Mujer en "Nueva Coleccion".
# Correr desde la raiz del theme kevingston despues de cada `theme pull`.
import json, copy, collections, sys

P = 'templates/pages/home.json'

TAB_H = ('<span data-kv-tab="hombre" style="color:#000000;border-bottom:1px solid #000000;'
         'padding-bottom:2px;cursor:pointer">Hombre</span>'
         '<span data-kv-tab="mujer" style="color:#737373;margin-left:24px;cursor:pointer">Mujer</span>')
TAB_M = ('<span data-kv-tab="hombre" style="color:#737373;cursor:pointer">Hombre</span>'
         '<span data-kv-tab="mujer" style="color:#000000;border-bottom:1px solid #000000;'
         'padding-bottom:2px;margin-left:24px;cursor:pointer">Mujer</span>')
MUJER_CAT = '39815676'

d = json.load(open(P, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
secs = d['sections']
h = secs['new_collection_1']
hr = h['blocks']['header_row']

# 1) mobile_direction column (idempotente)
st = hr['settings']
if not st.get('mobile_direction_enabled'):
    ns = collections.OrderedDict()
    for k, v in st.items():
        ns[k] = v
        if k == 'direction':
            ns['mobile_direction_enabled'] = True
            ns['mobile_direction'] = 'column'
    hr['settings'] = ns

# 2) tabs Hombre con data-kv-tab
hr['blocks']['tabs']['settings']['text'] = TAB_H

# 3) seccion Mujer (crear si no existe)
if 'new_collection_1_mujer' not in secs:
    m = copy.deepcopy(h)
    hrb = m['blocks'].pop('header_row'); m['blocks']['header_row_m'] = hrb
    pr = m['blocks'].pop('products'); m['blocks']['products_m'] = pr
    m['block_order'] = ['header_row_m', 'products_m']
    inner = m['blocks']['header_row_m']['blocks']
    t = inner.pop('title'); inner['title_m'] = t
    tb = inner.pop('tabs'); inner['tabs_m'] = tb
    m['blocks']['header_row_m']['block_order'] = ['title_m', 'tabs_m']
    inner['tabs_m']['settings']['text'] = TAB_M
    m['blocks']['products_m']['settings']['products_source'] = collections.OrderedDict(
        [('kind', 'category'), ('id', MUJER_CAT)])
    new = collections.OrderedDict()
    for k, v in secs.items():
        new[k] = v
        if k == 'new_collection_1':
            new['new_collection_1_mujer'] = m
    d['sections'] = new
    if 'new_collection_1_mujer' not in d['order']:
        i = d['order'].index('new_collection_1')
        d['order'].insert(i + 1, 'new_collection_1_mujer')
else:
    m = secs['new_collection_1_mujer']
    m['blocks']['header_row_m']['blocks']['tabs_m']['settings']['text'] = TAB_M
    m['blocks']['products_m']['settings']['products_source'] = collections.OrderedDict(
        [('kind', 'category'), ('id', MUJER_CAT)])

json.dump(d, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
open(P, 'a', encoding='utf-8').write('\n')
json.load(open(P, encoding='utf-8'))  # valida
print('OK: tabs Hombre/Mujer aplicados. sections:', len(d['sections']),
      '| mujer en order:', 'new_collection_1_mujer' in d['order'])
