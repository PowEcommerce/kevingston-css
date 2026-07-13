# kevingston-css

CSS externo del theme **Kevingston** (Tiendanube, modo compose-only).

## Por qué existe
El campo `css_code` del theme tiene un límite de **15000 caracteres** y toda la web no entra.
Solución: el CSS vive acá (sin límite, legible, versionado) y el theme lo carga con un
`@import` chiquito desde `settings_data.json`.

## Cómo se conecta
En el `css_code` del theme queda solo el loader:

```css
@import url("https://<HOST>/theme.css");
```

## Flujo de trabajo
1. Editás `theme.css` acá.
2. `git push` a GitHub.
3. Se actualiza en la tienda (según el host, entre instantáneo y ~10 min de caché CDN).

Para forzar refresco durante desarrollo se puede bumpear `?v=N` en el `@import`.
