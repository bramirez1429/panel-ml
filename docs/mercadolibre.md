# Integración con Mercado Libre

La integración está dividida entre el controller de Mercado Libre, su service y el service de Supabase. Los tokens se guardan en Supabase y nunca se incluyen en las respuestas de la API.

## Configuración de Supabase

Antes de conectar una cuenta, creá esta tabla en Supabase:

```sql
create table if not exists mercadolibre_tokens (
  seller_id bigint primary key,
  nickname text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz default now()
);
```

La conexión usa las variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. La lectura y escritura de la tabla se realiza desde `src/database/supabase.service.ts`.

## OAuth

El flujo OAuth está en `src/mercadolibre/mercadolibre.controller.ts` y `src/mercadolibre/mercadolibre.service.ts`.

### Conectar una cuenta

Abrí:

```text
GET /mercadolibre/connect
```

`connect()` llama a `createAuthorizationUrl()` y redirige al usuario a Mercado Libre para autorizar la aplicación.

### Procesar el callback

Mercado Libre vuelve a:

```text
GET /mercadolibre/callback?code=...&state=...
```

`callback()` valida el `state`, intercambia el código con `exchangeCode()`, consulta el vendedor con `getCurrentUser()` y guarda los tokens mediante `saveTokens()`. La respuesta solo confirma la conexión y muestra los datos públicos del vendedor.

## Guardado y renovación de tokens

Las funciones están en `src/mercadolibre/mercadolibre.service.ts`:

- `saveTokens()` calcula `expires_at` y crea o actualiza la conexión en Supabase.
- `getStoredConnection()` recupera la cuenta conectada y avisa si primero es necesario usar `/mercadolibre/connect`.
- `getValidAccessToken()` reutiliza el token cuando tiene más de cinco minutos de vigencia.
- `refreshAccessToken()` renueva un token próximo a vencer y guarda inmediatamente los nuevos datos en Supabase.

Las operaciones directas sobre `mercadolibre_tokens` están en `src/database/supabase.service.ts`.

## Publicaciones paginadas

Para consultar una página:

```text
GET /mercadolibre/publicaciones?limit=50
```

La respuesta incluye las publicaciones completas de esa página y `nextScrollId`. Para pedir la siguiente página, enviá ese valor sin modificar:

```text
GET /mercadolibre/publicaciones?limit=50&scrollId=VALOR_RECIBIDO
```

Repetí la consulta mientras `finished` sea `false`. Reutilizá el mismo `nextScrollId` dentro de los cinco minutos siguientes. El límite predeterminado es 50 y el máximo es 100. Los detalles se consultan en grupos de hasta 20 IDs.

Mercado Libre no garantiza que repita `total` en cada página del scan. Si lo omite, la API devuelve `total: null`; conservá el total informado en la primera respuesta.

El endpoint está en `mercadolibre.controller.ts`; la consulta paginada y el multiget están en `mercadolibre.service.ts`.

## Consultar una publicación

```text
GET /mercadolibre/publicaciones/:itemId
```

El endpoint obtiene automáticamente un token vigente y devuelve la publicación indicada. El controller y la consulta a Mercado Libre están en los archivos `mercadolibre.controller.ts` y `mercadolibre.service.ts`, respectivamente.

## Modificar el precio

```text
PUT /mercadolibre/publicaciones/:itemId/precio
Content-Type: application/json

{
  "price": 38000
}
```

El precio es obligatorio, numérico y mayor que cero. La ruta está en `mercadolibre.controller.ts`, la llamada a Mercado Libre está en `mercadolibre.service.ts` y la validación del body está en `src/mercadolibre/update-price.dto.ts`.

Si la publicación tiene una automatización de precios activa, Mercado Libre puede rechazar el cambio. La API conserva su código y mensaje de error, pero elimina cualquier credencial sensible.

## Webhook

```text
POST /mercadolibre/webhook
```

El webhook permanece en `src/mercadolibre/mercadolibre.controller.ts` y responde rápidamente para confirmar la recepción.
