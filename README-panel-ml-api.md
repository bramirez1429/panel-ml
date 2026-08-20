# Panel ML API

Backend profesional en **NestJS + TypeScript** para administrar publicaciones de Mercado Libre desde una API propia, separando claramente lectura, edición, promociones, stock, SKU, imágenes, atributos, descripción, shipping y familias de productos.

El proyecto centraliza en un backend propio la integración directa con Mercado Libre, aplicando una arquitectura modular por dominio para mantener separadas autenticación, publicaciones, familias, edición, promociones, shipping, sincronización y persistencia.

---

## 1. Estado actual

**Estado:** Backend funcional y compilando sin errores.

Última validación manual:

- `npm run build` → **0 errores**.
- Publicación clásica de prueba → sin promoción activa y precio normal restaurado.
- Publicación nueva de prueba → sin promoción activa y precio normal restaurado.
- Shipping ampliado → funcionando.
- Git → working tree limpio y rama `main` sincronizada con `origin/main`.

### URL de producción

```text
https://panel-ml.vercel.app
```

### API principal

```text
https://panel-ml.vercel.app/mercadolibre
```

---

## 2. Objetivo del proyecto

Centralizar el manejo de Mercado Libre en un backend propio, estable y mantenible, encapsulando los detalles técnicos y reglas de negocio de la API de Mercado Libre dentro de NestJS.

El backend se encarga de:

- OAuth y tokens.
- Lectura de publicaciones.
- Detección de modelo clásico/nuevo.
- Familias y variantes.
- Precio.
- Stock.
- SKU.
- Imágenes.
- Estado de publicación.
- Descripción.
- Atributos.
- Shipping.
- Promociones.
- Consistencia eventual de Mercado Libre.
- Validaciones específicas de cada modelo.

---

## 3. Stack

### Backend

- **Node.js**
- **NestJS**
- **TypeScript**
- API REST

### Servicios externos

- **Mercado Libre API**
- **Mercado Libre OAuth**
- **Mercado Libre Seller Promotions API**
- **Supabase / PostgreSQL** para persistencia y sincronización existente
- **Vercel** para deploy del backend
- **GitHub** para control de versiones

---

## 4. Arquitectura

La arquitectura sigue principios **SOLID**, principalmente **SRP — Single Responsibility Principle**.

Regla principal:

> Cada dominio tiene su propio controller, service y types. Los controllers son finos y la lógica queda en services especializados.

No se utiliza un único service gigante para toda la integración de Mercado Libre.

### Flujo general

```text
HTTP Requests
        |
        v
NestJS Controllers
        |
        v
Domain Services
        |
        +--> Mercado Libre API
        |
        +--> Supabase / PostgreSQL
        |
        +--> Token / OAuth services
```

---

## 5. Organización de `direct-publications`

La lógica directa de publicaciones se encuentra en:

```text
src/mercadolibre/direct-publications/
```

Estructura principal:

```text
direct-publications/
├── attributes/
├── description/
├── families/
├── items/
├── pictures/
├── pricing/
├── promotions/
├── publications/
├── shipping/
├── sku/
└── stock/
```

### Responsabilidad por dominio

| Dominio | Responsabilidad |
|---|---|
| `publications` | Listado, búsqueda y detalle de publicaciones |
| `families` | Familias de la versión nueva y operaciones a nivel familia |
| `items` | Lectura/base y edición general de MLA |
| `pricing` | Lectura y normalización de precios |
| `promotions` | Lectura, alta, cambio y baja de promociones |
| `stock` | Lectura y edición de stock |
| `sku` | Lectura y edición de SKU |
| `pictures` | Lectura y edición de imágenes |
| `description` | Lectura y edición de descripción |
| `attributes` | Lectura y edición de atributos |
| `shipping` | Lectura y edición segura de shipping |

---

## 6. Separación importante: Direct API vs sincronización histórica

Existen dos áreas que **no deben confundirse**.

### Direct publications

```text
src/mercadolibre/direct-publications/
```

Trabaja directamente contra Mercado Libre y representa la capa de acceso directo utilizada por la API actual.

### Sync / Supabase existente

```text
src/mercadolibre/publications/
```

Corresponde al flujo histórico de sincronización/persistencia con Supabase.

**No mover ni mezclar responsabilidades entre ambos módulos sin una decisión arquitectónica explícita.**

---

## 7. Conexión con Mercado Libre

La integración utiliza OAuth de Mercado Libre.

### Callback OAuth

```http
GET /mercadolibre/callback?code=...&state=...
```

El backend recibe el `authorization_code`, valida el flujo y administra la conexión/token desde servicios dedicados.

### Webhook

```http
POST /mercadolibre/webhook
```

El webhook responde rápidamente a Mercado Libre y permite procesar notificaciones de manera desacoplada del resto de la lógica de negocio.

### Tokens

El código utiliza servicios especializados para obtener un access token válido antes de llamar a Mercado Libre.

El resto de los dominios no debe implementar OAuth por su cuenta.

```text
Domain Service
    |
    v
MercadolibreTokenService
    |
    v
MercadolibreApiService
    |
    v
Mercado Libre
```

---

## 8. Wrapper de Mercado Libre

La comunicación HTTP centralizada se encuentra en el service compartido de API de Mercado Libre.

Responsabilidades:

- `GET`
- `POST`
- `PUT`
- `PATCH` cuando corresponda
- `DELETE`
- headers
- lectura de respuestas
- propagación uniforme de errores

### DELETE con body vacío

Mercado Libre puede responder un `200 OK` con body vacío.

El wrapper ya contempla este caso y no intenta interpretar una respuesta vacía como JSON inválido.

Esto evita falsos `502` después de operaciones DELETE exitosas.

---

## 9. Modelos de publicación soportados

Se soportan los dos modelos actuales utilizados por la cuenta.

### `SHARED`

Representa la **versión clásica**.

```text
SHARED = Versión clásica
```

Puede contener variaciones dentro del mismo MLA.

### `VARIANT_PRICING`

Representa la **versión nueva**.

```text
VARIANT_PRICING = Versión nueva
```

La estructura se maneja como familia + items/user products.

Ejemplo conceptual:

```text
Familia
├── MLA variante 1
├── MLA variante 2
└── MLA variante 3
```

### Detección

La clasificación está centralizada en `PublicationsMapper`.

No debe duplicarse lógica de detección en controllers o services individuales.

---

## 10. Endpoints principales de lectura

### Detalle de publicación

```http
GET /mercadolibre/direct/publicaciones/:itemId
```

Devuelve un detalle amigable con información como:

- modelo
- versión
- identificadores
- título
- familia
- estado
- stock
- pricing
- promociones
- SKU
- imágenes
- variaciones
- atributos
- shipping
- tags
- permalink
- términos de venta
- fechas

### Familia

```http
GET /mercadolibre/direct/familias/:familyId
```

Permite obtener la estructura de una publicación nueva por familia.

### Publicaciones agrupadas

Existe flujo de publicaciones agrupadas para separar familias de publicaciones clásicas.

La optimización futura conocida como **PANDA** no forma parte del alcance final actual.

---

## 11. Base de rutas de edición

Todas las ediciones directas están agrupadas bajo:

```text
/mercadolibre/direct/edicion
```

Esto separa claramente lectura de operaciones mutables.

---

## 12. Edición general de items

### Clásica

```http
PATCH /mercadolibre/direct/edicion/clasica/:itemId
```

### Nueva

```http
PATCH /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId
```

Estas rutas se utilizan para cambios generales del item.

Las operaciones especializadas como stock, imágenes o promociones tienen sus propios controllers/services.

---

## 13. Familias de la versión nueva

La edición a nivel familia se encuentra separada de la edición de MLA.

Ejemplo:

```http
PATCH /mercadolibre/direct/edicion/nueva/:familyId
```

Mercado Libre puede procesar algunas modificaciones mediante tareas asíncronas.

El backend permite consultar el estado de dichas tareas mediante la ruta correspondiente del `FamilyController`.

---

## 14. Stock

### Clásica

```http
GET   /mercadolibre/direct/edicion/clasica/:itemId/stock
PATCH /mercadolibre/direct/edicion/clasica/:itemId/stock
```

### Nueva

```http
GET   /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/stock
PATCH /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/stock
```

Para la versión nueva se contempla el modelo de stock asociado a `user_product_id` cuando corresponde.

---

## 15. SKU

### Clásica

```http
GET   /mercadolibre/direct/edicion/clasica/:itemId/sku
PATCH /mercadolibre/direct/edicion/clasica/:itemId/sku
```

### Nueva

```http
GET   /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/sku
PATCH /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/sku
```

---

## 16. Imágenes

### Clásica

```http
GET   /mercadolibre/direct/edicion/clasica/:itemId/imagenes
PATCH /mercadolibre/direct/edicion/clasica/:itemId/imagenes
```

### Nueva

```http
GET   /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/imagenes
PATCH /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/imagenes
```

En la versión nueva, la lectura utiliza la información asociada al User Product cuando corresponde.

---

## 17. Descripción

### Clásica

```http
GET   /mercadolibre/direct/edicion/clasica/:itemId/descripcion
PATCH /mercadolibre/direct/edicion/clasica/:itemId/descripcion
```

### Nueva

```http
GET   /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/descripcion
PATCH /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/descripcion
```

---

## 18. Atributos

### Clásica

```http
GET   /mercadolibre/direct/edicion/clasica/:itemId/atributos
PATCH /mercadolibre/direct/edicion/clasica/:itemId/atributos
```

### Nueva

```http
GET   /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/atributos
PATCH /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/atributos
```

La lógica valida el modelo antes de editar para evitar operaciones incompatibles.

---

## 19. Shipping

Shipping tiene su dominio propio:

```text
src/mercadolibre/direct-publications/shipping/
```

### Clásica

```http
GET   /mercadolibre/direct/edicion/clasica/:itemId/envio
PATCH /mercadolibre/direct/edicion/clasica/:itemId/envio
```

### Nueva

```http
GET   /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/envio
PATCH /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/envio
```

### Respuesta amigable actual

El GET expone, cuando Mercado Libre lo informa:

```json
{
  "shipping": {
    "mode": "me2",
    "logisticType": "xd_drop_off",
    "freeShipping": true,
    "localPickUp": false,
    "storePickUp": false,
    "mandatoryFreeShipping": true,
    "isFlex": false,
    "isFull": false,
    "isDropOff": true,
    "tags": []
  }
}
```

### Reglas de seguridad

Si Mercado Libre indica:

```text
mandatoryFreeShipping = true
```

el backend **no permite** desactivar envío gratis.

No se inventan costos ni modalidades que Mercado Libre no devuelve.

### Fuera de alcance actual

- cálculo propio de costos de envío
- manipulación avanzada de logística no confirmada por la API
- reglas privadas de Full/Flex no expuestas por Mercado Libre

---

## 20. Pricing

El dominio `pricing` centraliza la lectura de precios.

El detalle expone una estructura similar a:

```json
{
  "standard": 64740,
  "current": 64740,
  "regular": null,
  "currency": "ARS",
  "all": [],
  "metadata": {}
}
```

### Semántica

- `standard`: precio base.
- `current`: precio efectivo actual.
- `regular`: precio anterior cuando existe una promoción activa.
- `all`: precios devueltos por Mercado Libre.
- `metadata`: campaña/promoción asociada al precio cuando corresponde.

---

## 21. Promociones

El backend soporta cuatro tipos comerciales de Mercado Libre:

```text
PRICE_DISCOUNT
DEAL
SELLER_CAMPAIGN
SMART
```

**Mercado Ads no forma parte de este módulo.**

Estructura:

```text
promotions/
├── promotions.service.ts
├── promotions.types.ts
├── price-discount.controller.ts
├── price-discount.service.ts
├── price-discount.types.ts
├── deal.controller.ts
├── deal.service.ts
├── deal.types.ts
├── seller-campaign.controller.ts
├── seller-campaign.service.ts
├── seller-campaign.types.ts
├── smart-promotion.controller.ts
├── smart-promotion.service.ts
├── smart-promotion.types.ts
├── promotion-manager.controller.ts
├── promotion-manager.service.ts
└── promotion-manager.types.ts
```

---

## 22. Lectura de promociones

`PromotionsService` consulta las promociones del MLA y clasifica la respuesta de Mercado Libre en:

```text
active
candidates
pending
all
```

Estados observados:

```text
candidate
started
pending
```

El service de lectura representa lo que Mercado Libre informa.

La reconciliación final se hace en la capa de detalle, donde también existe el precio efectivo.

---

## 23. PRICE_DISCOUNT

Permite crear un descuento directo por fechas.

Operaciones principales:

```text
POST
DELETE
```

### Fechas

Mercado Libre exige fechas locales sin offset.

Correcto:

```text
2026-08-20T00:00:00
```

Incorrecto:

```text
2026-08-20T00:00:00-03:00
```

---

## 24. DEAL

Permite participar en promociones/campañas `DEAL` disponibles para el item.

Operaciones soportadas:

```text
POST   activar
PUT    modificar precio
DELETE eliminar
```

Se debe utilizar el `promotionId` devuelto como `candidate` por Mercado Libre; no se inventan ni se hardcodean campañas vencidas.

---

## 25. SELLER_CAMPAIGN

Permite trabajar con campañas comerciales del vendedor.

Operaciones soportadas:

```text
POST   activar
PUT    modificar precio
DELETE eliminar
```

### Credibilidad del descuento

Mercado Libre puede devolver:

```text
ERROR_CREDIBILITY_DISCOUNTED_PRICE
```

incluso si el precio está dentro de:

```text
min_discounted_price
max_discounted_price
suggested_discounted_price
```

Esto es una regla comercial de Mercado Libre y no un error técnico del backend.

El backend propaga este error comercial sin convertirlo en un retry técnico ni ocultar la causa devuelta por Mercado Libre.

---

## 26. SMART

SMART funciona de manera distinta a DEAL o SELLER_CAMPAIGN.

El usuario no define libremente un `dealPrice`.

El candidate incluye un `ref_id` de tipo:

```text
CANDIDATE-...
```

Para activar SMART se utilizan:

```text
promotionId
candidate offerId/ref_id
```

Después de activarla, Mercado Libre devuelve un identificador real:

```text
OFFER-...
```

Para eliminar una SMART activa se utiliza el `OFFER-...` real de la promoción started.

Operaciones:

```text
POST   activar
DELETE eliminar
```

No existe PUT de precio manual en este diseño.

---

## 27. Promotion Manager

`PromotionManagerService` es la capa de orquestación de promociones.

El manager centraliza las diferencias técnicas para eliminar y activar cada tipo de promoción.

### Ruta clásica

```http
POST /mercadolibre/direct/edicion/clasica/:itemId/promociones/cambiar
```

### Ruta nueva

```http
POST /mercadolibre/direct/edicion/nueva/:familyId/items/:itemId/promociones/cambiar
```

### Responsabilidad

```text
leer publicación
      ↓
detectar promoción activa
      ↓
eliminarla usando el service específico
      ↓
esperar consistencia de Mercado Libre
      ↓
esperar que aparezca el nuevo candidate
      ↓
activar nueva promoción
      ↓
reintentar únicamente errores temporales
      ↓
volver a consultar
      ↓
verificar status started
```

El manager **orquesta**; no contiene toda la implementación HTTP de cada promoción.

Eso mantiene el diseño SOLID.

---

## 28. Consistencia eventual de Mercado Libre

Mercado Libre no siempre refleja los cambios de forma inmediata.

Casos reales observados durante la implementación:

### DELETE

```text
DELETE exitoso
→ price puede volver a normal
→ seller-promotions todavía puede devolver started durante unos segundos
```

### Activación

```text
candidate visible
→ POST de activación
→ Mercado Libre responde temporalmente "No candidates found for item"
```

### Estrategia implementada

Promotion Manager cuenta con lógica equivalente a:

```text
waitForNoActivePromotion()
waitForCandidate()
activatePromotionWithRetry()
waitForPromotion()
```

La verificación final contempla una ventana mayor para evitar falsos `success: false` cuando Mercado Libre tarda en reflejar `started`.

Los retries se reservan para errores temporales conocidos.

Errores comerciales como `ERROR_CREDIBILITY_DISCOUNTED_PRICE` no deben convertirse en retries infinitos.

---

## 29. Reconciliación entre pricing y promociones

Un punto crítico es no confiar únicamente en `/seller-promotions`.

Mercado Libre puede seguir diciendo:

```text
status = started
```

cuando el precio efectivo ya volvió al valor normal.

Por eso `PublicationDetailMapper` reconcilia:

```text
price
+
promotions
```

### Ejemplo sin promoción efectiva

```text
current = 64740
regular = null
price.all sin type=promotion
metadata = {}
```

Aunque Mercado Libre todavía entregue temporalmente una promoción `started`, el detalle público puede considerar que ya no existe una promoción efectiva.

Esto evita exponer estados inconsistentes en la respuesta pública del backend.

---

## 30. Ejemplo de respuesta del Promotion Manager

```json
{
  "success": true,
  "previousPromotion": {
    "type": "PRICE_DISCOUNT",
    "status": "started",
    "price": 55000
  },
  "removedPreviousPromotion": true,
  "requestedPromotion": "SELLER_CAMPAIGN",
  "activePromotion": {
    "id": "C-...",
    "type": "SELLER_CAMPAIGN",
    "status": "started",
    "price": 50000
  },
  "verified": true
}
```

Este contrato permite conocer con claridad qué promoción existía, cuál fue solicitada y si el cambio quedó verificado.

---

## 31. Publicaciones utilizadas en validación manual

Se utilizaron publicaciones reales controladas para validar los dos modelos.

### Clásica

```text
itemId: MLA1515465481
modelo: SHARED
precio base validado: 22000 ARS
```

Estado final validado:

```text
standard: 22000
current: 22000
regular: null
active: []
```

### Nueva

```text
familyId: 5879808908997712
itemId: MLA1461568109
userProductId: MLAU2815517461
modelo: VARIANT_PRICING
precio base validado: 64740 ARS
```

Estado final validado:

```text
standard: 64740
current: 64740
regular: null
active: []
```

> Estos IDs se documentan como referencias de pruebas manuales. No deben convertirse en configuración fija de producción.

---

## 32. Smoke tests realizados

Se validaron manualmente operaciones en ambos modelos.

### Lecturas por feature

Clásica y nueva:

- stock ✅
- SKU ✅
- imágenes ✅
- descripción ✅
- atributos ✅
- shipping ✅

### Edición

- precio ✅
- título/familyName ✅
- stock ✅
- SKU ✅
- imágenes ✅
- estado pausa/activa ✅
- descripción ✅
- atributos ✅
- shipping ✅

### Promociones

- PRICE_DISCOUNT ✅
- DEAL POST/PUT/DELETE ✅
- SELLER_CAMPAIGN POST/PUT/DELETE ✅
- SMART POST/DELETE ✅

### Promotion Manager

Transiciones comprobadas durante el desarrollo:

```text
DEAL -> SELLER_CAMPAIGN
SMART -> DEAL
SELLER_CAMPAIGN -> PRICE_DISCOUNT
PRICE_DISCOUNT -> SELLER_CAMPAIGN
```

---

## 33. Manejo de errores

Los errores de Mercado Libre deben mantenerse diferenciados.

### Error técnico/transitorio

Ejemplo:

```text
No candidates found for item
```

Puede requerir retry controlado debido a consistencia eventual.

### Error comercial

Ejemplo:

```text
ERROR_CREDIBILITY_DISCOUNTED_PRICE
```

Debe propagarse al consumidor de la API sin alterar su significado.

No debe ocultarse con retries genéricos.

### DELETE idempotente

Mercado Libre puede informar:

```text
No offers found for item
```

cuando la oferta ya fue eliminada.

La capa de orquestación puede tratar específicamente ese escenario como un estado final equivalente a "ya eliminado", sin esconder otros errores.

---

## 34. Seguridad

### Nunca versionar

- Client Secret de Mercado Libre.
- Access Tokens.
- Refresh Tokens.
- Supabase Service Role Key.
- credenciales privadas.

### `.env`

Las credenciales deben existir únicamente como variables de entorno locales/producción.

El archivo `.env.example` debe contener placeholders, nunca secretos reales.

### Vercel

Las variables de producción deben configurarse desde Environment Variables del proyecto.

### GitHub

GitHub Push Protection debe mantenerse habilitado para evitar commits accidentales de secretos.

---

## 35. Variables de entorno

Los nombres exactos deben seguir los definidos actualmente por el repositorio y `.env.example`.

Como mínimo el sistema necesita conceptualmente:

```text
Mercado Libre Client ID
Mercado Libre Client Secret
OAuth Redirect URI
credenciales/token storage
Supabase URL
Supabase key de backend
```

No documentar valores reales en este README.

---

## 36. Desarrollo local

Instalar dependencias:

```bash
npm install
```

Compilar:

```bash
npm run build
```

Ejecutar utilizando los scripts definidos en `package.json` para desarrollo local.

Antes de subir cambios importantes:

```bash
npm run build
git status
```

El build debe quedar en `0 errores`.

---

## 37. Pruebas manuales con Git Bash

En algunas instalaciones de Windows, `curl` utiliza `schannel` y puede fallar la validación de revocación del certificado.

Para pruebas manuales del proyecto se utilizó:

```bash
curl --ssl-no-revoke ...
```

Ejemplo:

```bash
curl --ssl-no-revoke -sS \
  "https://panel-ml.vercel.app/mercadolibre/direct/publicaciones/MLA1515465481"
```

Para formatear JSON con Node:

```bash
curl --ssl-no-revoke -sS "URL" \
| node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(d),null,2)))'
```

---

## 38. Deploy

El backend se encuentra desplegado en Vercel.

```text
Production domain:
https://panel-ml.vercel.app
```

Flujo esperado:

```text
git push
   ↓
GitHub
   ↓
Vercel build
   ↓
NestJS deployment
   ↓
https://panel-ml.vercel.app
```

Después de cambios críticos realizar un smoke test contra producción.

---

## 39. Convenciones para continuar el proyecto

### Controllers

Deben:

- recibir params/body
- delegar al service
- evitar lógica de negocio compleja

### Services

Deben:

- pertenecer a un dominio claro
- encapsular reglas de negocio
- delegar HTTP genérico a `MercadolibreApiService`
- no duplicar OAuth/token handling

### Types

Mantener los contratos junto al dominio correspondiente.

Ejemplo:

```text
shipping/
  shipping.controller.ts
  shipping.service.ts
  shipping.types.ts
```

### No crear carpetas genéricas innecesarias

Evitar directorios como:

```text
misc/
helpers/
utils/
common/
```

si la lógica tiene un dominio claro donde pertenecer.

---

## 40. Principios de diseño

### SOLID

Especialmente:

- **S** — cada service con una responsabilidad clara.
- **O** — nuevos tipos de promoción pueden agregarse sin reescribir todo.
- **D** — orquestadores dependen de services especializados, no de detalles HTTP duplicados.

### Source of truth

- Mercado Libre es source of truth para el estado remoto.
- Pricing efectivo se utiliza para resolver inconsistencias temporales de promociones.
- Supabase sirve al flujo de persistencia/sync donde corresponde, pero no reemplaza automáticamente la lectura directa.

---

## 41. Alcance que NO forma parte del backend actual

### Mercado Ads

No está implementado dentro de Promotion Manager.

Promociones actuales significan solamente:

```text
PRICE_DISCOUNT
DEAL
SELLER_CAMPAIGN
SMART
```

### PANDA

Existe como optimización futura para que el listado agrupado devuelva familias livianas y cargue variantes únicamente al abrir una familia.

No está incluido en el cierre actual.

### Shipping avanzado no confirmado

No se implementan endpoints o costos que Mercado Libre no exponga de manera confirmada.

---


## 42. Resumen ejecutivo

Actualmente `Panel ML API` cuenta con una base backend sólida para administrar Mercado Libre mediante una API propia.

### Soportado

```text
OAuth                      ✅
Webhook                    ✅
Publicaciones              ✅
Clásica / SHARED           ✅
Nueva / VARIANT_PRICING    ✅
Familias                   ✅
Precio                     ✅
Stock                      ✅
SKU                        ✅
Imágenes                   ✅
Estado publicación         ✅
Descripción                ✅
Atributos                  ✅
Shipping                   ✅
PRICE_DISCOUNT             ✅
DEAL                       ✅
SELLER_CAMPAIGN            ✅
SMART                      ✅
Promotion Manager          ✅
Consistencia eventual ML   ✅
Build producción           ✅
Deploy Vercel              ✅
```

El backend queda consolidado como una capa de dominio propia para administrar operaciones de Mercado Libre mediante contratos controlados y servicios especializados.

---

## 43. Regla final para futuras implementaciones

Antes de implementar una función nueva:

1. identificar su dominio;
2. verificar si Mercado Libre la soporta realmente;
3. agregarla al service correcto;
4. mantener controller fino;
5. evitar duplicación;
6. validar clásica y nueva cuando corresponda;
7. ejecutar `npm run build`;
8. hacer smoke test controlado;
9. dejar las publicaciones de prueba en un estado conocido;
10. crear un commit descriptivo.

---

**Panel ML API — Backend Mercado Libre**  
Arquitectura orientada a dominio, mantenible y preparada para evolucionar de forma segura sobre la integración con Mercado Libre.
