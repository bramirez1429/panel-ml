# Integraci\u00f3n con Mercado Libre

Mercado Libre es la fuente oficial y Supabase guarda una copia reducida para
el dashboard. Los endpoints de lectura nunca recorren la API de Mercado Libre.

## Preparaci\u00f3n

Ejecutar en Supabase SQL Editor:

```text
supabase/migrations/20260809000000_create_mercadolibre_publications.sql
supabase/migrations/20260822000000_scope_mercadolibre_tokens_by_user.sql
```

La migraci\u00f3n crea `mercadolibre_products` y
`mercadolibre_product_children`, sus \u00edndices, la FK con borrado en cascada y
activa RLS sin policies p\u00fablicas. Tambi\u00e9n activa RLS en la tabla existente de
tokens. El backend sigue accediendo con `SUPABASE_SERVICE_ROLE_KEY`.

La migración `20260822000000_scope_mercadolibre_tokens_by_user.sql` agrega el
`user_id` de la aplicación a `mercadolibre_tokens`, crea su FK con `users` y
garantiza una conexión por usuario. Debe aplicarse después de las migraciones de
autenticación que crean `users`. También crea la tabla privada de transacciones
OAuth y las funciones atómicas que registran y consumen cada `state` una sola
vez, vinculándolo a la sesión de refresh que inició el flujo.

Las conexiones globales anteriores no tienen información suficiente para
inferir un dueño de forma segura. La migración elimina esas filas legacy; cada
usuario afectado debe volver a ejecutar el flujo **Conectar Mercado Libre**.

## Responsabilidades

- `auth/`: OAuth, state firmado por usuario, almacenamiento y refresh de
  tokens.
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

Para iniciar la conexión, el frontend llama al endpoint con el access JWT de la
aplicación:

```text
GET /mercadolibre/connect
Authorization: Bearer <access-jwt-de-la-aplicacion>
```

`GET /mercadolibre/connect` exige un usuario autenticado y responde HTTP 200 con
una URL, no con una redirección directa:

```json
{
  "url": "https://auth.mercadolibre.com.ar/authorization?..."
}
```

La llamada `fetch` a `/connect` debe usar `credentials: 'include'`. El backend
emite una cookie de correlación corta, única por transacción, `HttpOnly`,
`SameSite=Lax` y restringida al path configurado en `ML_REDIRECT_URI`. No
contiene tokens de Mercado Libre: sirve para comprobar que la autorización
vuelve al mismo navegador que la inició. Frontend y API deben desplegarse en el
mismo site; CORS con credenciales no evita por sí solo el bloqueo de cookies de
terceros entre sitios distintos.

El frontend debe navegar a esa `url` para continuar en Mercado Libre. No debe
agregar el JWT de la aplicación a la URL de Mercado Libre.

Mercado Libre vuelve al callback existente:

```text
GET /mercadolibre/callback?code=...&state=...
```

El callback es público porque la redirección de Mercado Libre no conserva el
header `Authorization`. La asociación no depende de un `user_id` enviado por el
frontend: el `state` contiene el `user_id` autenticado que inició el flujo, un
nonce y un timestamp, todo protegido por firma HMAC y con vencimiento. El
callback valida esa firma y la cookie, exige que la misma sesión de refresh siga
vigente y consume la transacción en Supabase de forma atómica. Solo el primer
callback válido puede recuperar al dueño; luego intercambia el código, consulta
`/users/me` y guarda la conexión para ese usuario.

La respuesta del callback incluye solamente el resultado y los datos públicos
básicos del vendedor. Nunca devuelve `access_token`, `refresh_token` ni Client
Secret.

La firma del `state` tambien cubre el hash de la cookie de correlacion. El
callback rechaza URLs compartidas o abiertas en otro navegador, rechaza replay
y elimina solamente la cookie de la transacción validada. Un callback inválido
no cancela otro flujo pendiente.

### Tokens por usuario

Los tokens de Mercado Libre se guardan exclusivamente en Supabase mediante el
backend y asociados al `user_id` de la aplicación. El frontend no debe guardar
tokens de Mercado Libre en memoria persistente, cookies, `localStorage` ni
`sessionStorage`; tampoco debe recibirlos mediante respuestas o URLs.

Cada operación autenticada busca la conexión de su propio usuario. Cuando el
`access_token` está vencido o próximo a vencer, el backend lo renueva
automáticamente usando el `refresh_token` de ese mismo dueño y persiste los
tokens nuevos en su conexión. Una conexión obtenida para otro `user_id` se
rechaza. La persistencia del refresh usa compare-and-swap por owner, seller y
versión para que un refresh viejo no sobrescriba una reconexión; si otro worker
gana la renovación, la operación recarga y usa el token vigente guardado.

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

## Campañas de promociones

```text
GET /mercadolibre/direct/promociones/campaigns
```

El endpoint consulta directamente las campañas globales del seller autenticado
con `GET /seller-promotions/users/{SELLER_ID}?app_version=v2`; no recorre el
catálogo ni calcula cobertura de publicaciones. Para el análisis posterior de
una campaña seleccionada se usará la fuente oficial:

```text
GET /seller-promotions/promotions/{PROMOTION_ID}/items
  ?promotion_type={PROMOTION_TYPE}
  &app_version=v2
```

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
