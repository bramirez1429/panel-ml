# Tienda Negocio — Sincronización de Mercado Libre

**Rama de trabajo:** `feature/tienda-negocio-sincronizacion` (frontend y backend).

## Qué implementamos

- Módulo NestJS `src/tiendanegocio`, aislado de Tiendanube.
- Lectura de publicaciones por vendedor y de **todas las páginas** del scan de Mercado Libre.
- Agrupación por `sourceKey`: `family:<familyId>` en User Products y `item:<MLA>` en publicaciones clásicas.
- Reutilización del normalizador de Mercado Libre, no del adaptador de escritura de Tiendanube.
- Mapper específico a atributos/variantes/SKU/precio/stock/formato Tienda Negocio.
- Vista previa de producto solo lectura, sin POST.
- Cliente REST aislado, con token solo en NestJS.
- Endpoint de instalación OAuth y callback firmado por la sesión del panel.
- Migraciones SQL de conexiones y diseño de estados de migración.
- Servicio para subir imágenes desde CDNs de ML, por el endpoint documentado.
- Frontend SSR, navegación y página por producto.

## Preparación obligatoria

1. Crear una **aplicación para sus clientes** en https://referidos.tiendanegocio.com
   para evitar homologación pública mientras se prueba la integración.
2. En la aplicación, solicitar acceso `read_products` y `write_products` y
   configurar la URL de retorno
   `https://saeltendencia.online/api/integrations/tienda-negocio/callback`.
3. Guardar en el entorno del backend de Vercel, sin publicar el secreto ni
   colocar variables `NEXT_PUBLIC_*`:
   - `TIENDANEGOCIO_APP_ID`
   - `TIENDANEGOCIO_APP_SECRET`
   - `TIENDANEGOCIO_APP_HANDLE`
4. Ejecutar las dos migraciones SQL `20261021000000` y `20261021010000`
   en una base de datos de prueba y comprobar sus políticas RLS.
5. Entrar a la nueva página del panel y autorizar la tienda.
6. Probar catálogo y vistas previas con datos reales. Verificar permisos,
   campos e imágenes según las respuestas efectivas de la API.

**Las migraciones SQL NO se aplican automáticamente al hacer deploy.**

## Pendientes antes de habilitar "Migrar todo"

**El sistema todavía NO realiza una sincronización completa.**

- Implementar persistencia transaccional y reserva de un `sourceKey` para
  no duplicar productos ante timeouts, concurrencia o reintentos.
- Crear job de migración global con descubrimiento paginado y proceso en
  lotes/concurrencia limitada, con estados, reintentos y reanudación.
- Reconciliar el resultado de un POST incierto **antes de reintentar**.
- Asociar las imágenes cargadas y sus variantes por color/talle. El servicio
  HTTP de imágenes está listo para pruebas, pero no se invoca en un job aún.
- Decidir asociación de categorías de ML a categorías de Tienda Negocio.
- Confirmar la política de precios, publicación y stock al cambiar de canal.
- Controlar rate limits, errores por producto, rollback y resúmenes finales.
- Pruebas unitarias, de integración con API mock y funcionales end-to-end
  en una tienda de prueba.
- Definir si "100% sincronizado" significa importación inicial únicamente o
  actualización continua bidireccional con webhooks.

**No cambiar `migrationEnabled: false`** hasta cumplir estas verificaciones.
No hacer merge a `main` ni desplegar producción sin aprobación.

## Referencias oficiales

- https://docs.developers.tiendanegocio.com/docs/authentication
- https://docs.developers.tiendanegocio.com/docs/app
- https://docs.developers.tiendanegocio.com/docs/api/products
- https://docs.developers.tiendanegocio.com/docs/api/images
