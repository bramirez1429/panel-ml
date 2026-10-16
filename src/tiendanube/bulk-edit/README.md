# Edición masiva de Tiendanube

Los endpoints requieren un access token de la aplicación y están disponibles bajo
`/tiendanube/bulk-edit` y el alias `/tiendanube/bulk-edition`.

## Crear trabajo

`POST /tiendanube/bulk-edition/jobs`

```json
{ "snapshotId": "db6e47c3-6d7a-4f35-9f8c-6af6c2fd9b0b" }
```

Respuesta `201`:

```json
{ "id": "03c3905c-606f-4b12-89ea-cba9e1ffc3ab", "status": "QUEUED" }
```

El snapshot debe pertenecer al usuario y tienda autenticados, no estar vencido y
no contener incompatibilidades. La confirmación encola inmediatamente el worker.

## Consultar trabajo

`GET /tiendanube/bulk-edition/jobs/03c3905c-606f-4b12-89ea-cba9e1ffc3ab`

Respuesta `200`:

```json
{
  "id": "03c3905c-606f-4b12-89ea-cba9e1ffc3ab",
  "status": "RUNNING",
  "categoryId": "12345",
  "totalProducts": 14,
  "totalVariants": 38,
  "completedVariants": 20,
  "failedVariants": 1,
  "pendingVariants": 17,
  "startedAt": "2026-10-16T13:00:00.000Z",
  "finishedAt": null,
  "error": null,
  "createdAt": "2026-10-16T12:59:58.000Z",
  "updatedAt": "2026-10-16T13:00:04.000Z"
}
```

Estados: `QUEUED`, `RUNNING`, `COMPLETED`, `COMPLETED_WITH_ERRORS` y `PAUSED`.

## Consultar fallos

`GET /tiendanube/bulk-edition/jobs/03c3905c-606f-4b12-89ea-cba9e1ffc3ab/failures`

Respuesta `200`:

```json
[
  {
    "productId": "815",
    "productName": "Remera clásica",
    "variantId": "9001",
    "sku": "REM-AZ-M",
    "attempts": 1,
    "code": "TIENDANUBE_VARIANT_REJECTED",
    "reason": "Tiendanube rechazó la actualización de la variante",
    "updatedAt": "2026-10-16T13:00:03.000Z"
  }
]
```

## Reintentar fallos

`POST /tiendanube/bulk-edition/jobs/03c3905c-606f-4b12-89ea-cba9e1ffc3ab/retry-failures`

No lleva body. Sólo opera un trabajo `COMPLETED_WITH_ERRORS` propio y sólo los
items `ERROR` con menos de tres intentos; los `SUCCESS` no se modifican.

Respuesta `201`:

```json
{ "id": "03c3905c-606f-4b12-89ea-cba9e1ffc3ab", "status": "QUEUED", "retriedVariants": 1 }
```

Si no queda ningún fallo reintentable: `retriedVariants` es `0` y el estado se
mantiene en `COMPLETED_WITH_ERRORS`.

## Dependencia de base de datos

La migración `20261016010000_harden_tiendanube_bulk_edit.sql` es obligatoria
antes de ejecutar trabajos: agrega las leases y las RPC usadas por el worker.
No se ejecuta automáticamente desde la aplicación.
