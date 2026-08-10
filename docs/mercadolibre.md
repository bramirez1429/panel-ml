# Integraci\u00f3n con Mercado Libre

Mercado Libre es la fuente oficial y Supabase guarda una copia reducida para
el dashboard. Los endpoints de lectura nunca recorren la API de Mercado Libre.

## Preparaci\u00f3n

Ejecutar en Supabase SQL Editor:

```text
supabase/migrations/20260809000000_create_mercadolibre_publications.sql
```

La migraci\u00f3n crea `mercadolibre_products` y
`mercadolibre_product_children`, sus \u00edndices, la FK con borrado en cascada y
activa RLS sin policies p\u00fablicas. Tambi\u00e9n activa RLS en la tabla existente de
tokens. El backend sigue accediendo con `SUPABASE_SERVICE_ROLE_KEY`.

## Responsabilidades

- `auth/`: OAuth, state firmado, almacenamiento y refresh de tokens.
- `shared/mercadolibre-api.service.ts`: HTTP, Authorization, timeout, JSON y
  errores seguros.
- `publications/publications.service.ts`: listado y detalle desde Supabase.
- `publications/sync/publication-source.service.ts`: scan y multiget.
- `publications/sync/publication-sync.service.ts`: orquesta full sync y sync
  puntual.
- `publications/sync/publication-sync-preparer.service.ts`: resuelve familias y
  prepara bundles.
- `publications/sync/publication-sync-writer.service.ts`: persiste parents e
  hijos y finaliza el snapshot.
- `publications/normalization/`: detecta SHARED/VARIANT_PRICING y normaliza.
- `user-products/`: obtiene MLAU y resuelve `family_id` con cache por corrida.
- `database/repositories/`: solo lectura y escritura de Supabase.
- `webhook/`: recibe eventos y delega una sincronizaci\u00f3n puntual.

## OAuth

```text
GET /mercadolibre/connect
GET /mercadolibre/callback?code=...&state=...
```

El callback valida el state, intercambia el c\u00f3digo, consulta `/users/me` y
guarda los tokens. Nunca devuelve access token, refresh token ni Client Secret.

## Sincronizaci\u00f3n completa

```text
POST /mercadolibre/publicaciones/sync
```

El proceso:

1. Lee seller y obtiene un token vigente.
2. Recorre el scan con p\u00e1ginas de 100 y el mismo `scroll_id`.
3. Consulta detalles con multiget de 20 y hasta 4 lotes simult\u00e1neos.
4. Detecta el modelo usando solo `family_name`.
5. Resuelve MLAU/familias, normaliza y hace upsert.
6. Elimina hijos ausentes de familias reconstruidas.
7. Limpia parents no vistos solo si no hubo errores.

El `syncId` hace idempotente la reconciliaci\u00f3n. La limpieza tambi\u00e9n exige
que el registro sea anterior al inicio de la corrida para no borrar una
escritura concurrente m\u00e1s nueva.

## Lectura para Next.js

```text
GET /mercadolibre/publicaciones?page=1&limit=20
GET /mercadolibre/publicaciones/:productId
```

`productId` es el UUID interno de `mercadolibre_products`. El listado devuelve
solo res\u00famenes paginados. El detalle agrega `shared_variations` para SHARED o
`children` para VARIANT_PRICING.

### SHARED

Una fila parent con `external_key=item:MLA...`, sin hijos relacionales. Las
variaciones reducidas quedan en `shared_variations`.

### VARIANT_PRICING

Una fila parent con `external_key=family:...` y una fila child por MLA. El
`user_product_id` no es \u00fanico porque un MLAU puede tener varias condiciones de
venta.

## Webhook

```text
POST /mercadolibre/webhook
```

Para topics de \u00edtems sincroniza solo el MLA SHARED o reconstruye su familia.
Eventos repetidos durante el procesamiento se agrupan y provocan una segunda
lectura al terminar. El endpoint responde HTTP 200 sin esperar el trabajo.

En Vercel, el trabajo iniciado despu\u00e9s de responder no es una cola durable. Si
se requiere garant\u00eda de entrega, el pr\u00f3ximo paso es persistir un inbox y
procesarlo con un worker. Tambi\u00e9n se recomienda proteger el endpoint manual de
full sync con la autenticaci\u00f3n administrativa de la aplicaci\u00f3n.
