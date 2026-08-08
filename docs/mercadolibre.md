# Integración con Mercado Libre

La integración mantiene OAuth, almacenamiento y renovación de tokens, consulta de publicaciones y normalización para una tabla de Next.js. Los tokens y secretos se usan únicamente en el backend.

## Arquitectura

- `mercadolibre.controller.ts`: expone las rutas HTTP.
- `auth/mercadolibre-auth.service.ts`: autorización, `state`, callback, usuario y guardado inicial de tokens.
- `auth/mercadolibre-token.service.ts`: conexión guardada, vigencia y renovación del token.
- `shared/mercadolibre-api.service.ts`: solicitudes HTTP, autorización, timeout, JSON y errores de Mercado Libre.
- `publications/publications.service.ts`: scan, multiget, detalle y paginación.
- `publications/publication-groups.service.ts`: detecta el modelo y arma filas para la tabla.
- `user-products/user-products.service.ts`: resuelve MLAU y `family_id`.
- `database/supabase.service.ts`: lee y guarda la conexión en Supabase.

## OAuth

Para conectar una cuenta, abrir:

```text
GET /mercadolibre/connect
```

Mercado Libre vuelve a:

```text
GET /mercadolibre/callback?code=...&state=...
```

El callback valida el `state`, intercambia el código, consulta `/users/me` y guarda los tokens. La respuesta solo contiene:

```json
{
  "ok": true,
  "message": "Mercado Libre conectado correctamente",
  "seller": {
    "id": 123,
    "nickname": "MI_USUARIO"
  }
}
```

`MercadolibreTokenService` reutiliza el access token mientras le queden más de cinco minutos. Si está por vencer, usa el refresh token y guarda inmediatamente los tokens nuevos.

## Publicaciones para la tabla

```text
GET /mercadolibre/publicaciones?page=1&limit=20
```

El backend:

1. Recorre `/users/{sellerId}/items/search` con `search_type=scan`, páginas de 100 y el mismo `scroll_id`.
2. Elimina MLA duplicados.
3. Consulta detalles con multiget de hasta 20 IDs y máximo cuatro solicitudes simultáneas.
4. Detecta relaciones MLA, MLAU y family.
5. Agrupa y normaliza los productos.
6. Pagina las filas ya agrupadas.

Por eso, `limit=20` significa 20 productos padre para la tabla, no 20 MLA internos.

### Condición compartida

Las `variations[]` no se convierten en filas independientes:

```json
{
  "type": "SHARED",
  "parent": {
    "id": "MLA1561943005",
    "title": "Remeras Nenas Pack X4",
    "status": "active",
    "thumbnail": "https://...",
    "price": 35000
  },
  "children": []
}
```

### Condiciones por variante

Cada familia ocupa una fila y cada MLA independiente aparece como hijo:

```json
{
  "type": "VARIANT_PRICING",
  "parent": {
    "familyId": "8570150160678059",
    "title": "Remera Nena K-pop"
  },
  "children": [
    {
      "id": "MLA111",
      "userProductId": "MLAU111",
      "title": "Remera Nena K-pop Azul",
      "status": "active",
      "price": 35000
    }
  ]
}
```

La detección es conservadora: un MLAU presente solo dentro de `variations[]` no convierte una publicación compartida en condiciones independientes.

## Detalle y webhook

```text
GET /mercadolibre/publicaciones/MLA123
POST /mercadolibre/webhook
```

El detalle devuelve el body del ítem saneado. El webhook confirma inmediatamente con HTTP 200 y no procesa tareas pesadas.
