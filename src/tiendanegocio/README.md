# SAEL → Tienda Negocio (etapa 1: vista previa segura)

Este módulo reutiliza la autenticación existente del panel y las funciones de lectura
de Mercado Libre. No escribe productos en Tienda Negocio ni en Tiendanube.

## Endpoint de prueba

`GET /tiendanegocio/replication/preview-by-source?sourceKey=item:MLA123...`

Requiere el Bearer JWT del dashboard, igual que los endpoints de replicación actuales.
También acepta `family:123...`. Devuelve `product` (formato de Tienda Negocio),
`imageUrls`, advertencias y `readyForImport`.

Protecciones: `published: false`, variantes ocultas, SKU faltante/duplicado
identificado, sin copiar IDs de categoría incompatibles ni publicar precios
sin revisión. Las fotos **no se cargan** durante la vista previa.

## Paso siguiente (no incluido, aún no listo para producción)

1. Crear una **aplicación privada** para SAEL en el portal de partners de Tienda
   Negocio, vinculada a una tienda de pruebas. Solicitar `read_products` y
   `write_products`; `read_orders` para sincronización futura.
2. Implementar OAuth por workspace, con estado anti-CSRF, callback y token de
   tienda cifrado en servidor. No copiar tokens en chats ni en GitHub.
3. Revisar con la tienda de prueba las propiedades/variantes, imágenes base64,
   pagos y precios. Relacionar SKU + origen → ID de Tienda Negocio en DB,
   manejar reintentos e idempotencia y proteger altas inciertas.
4. Habilitar una importación de un solo producto mediante confirmación
   explícita; recién luego procesamiento por cola masivo, de a lotes.
5. Suscribir webhooks de ventas y validar firma/idempotencia antes de
   sincronizar stock bidireccional.

API oficial:
- https://docs.developers.tiendanegocio.com/docs/getting-started
- https://docs.developers.tiendanegocio.com/docs/authentication
- https://docs.developers.tiendanegocio.com/docs/api/products
- https://docs.developers.tiendanegocio.com/docs/api/images

Esta etapa **no sincroniza automáticamente stock, ventas ni imágenes**.
