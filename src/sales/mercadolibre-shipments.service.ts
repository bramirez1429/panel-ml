import { BadGatewayException, BadRequestException, Body, Controller, Get, Header, Injectable, Logger, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../auth/domain/auth.models';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import { MercadolibreTokenService } from '../mercadolibre/auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../mercadolibre/shared/mercadolibre-api.service';
import { SupabaseService } from '../database/supabase.service';
import { WorkspaceRepository } from '../workspaces/workspace.repository';
import { argentinaDay } from './sales-operations.service';
import { isObject, text, attributeKind } from './variant-normalization';

const DAYS = 60;
const MAX_ORDERS = 200;
const PAGE = 50;
const CONCURRENCY = 10;
const API_TIMEOUT = 4000;
const PENDING = new Set(['pending', 'handling', 'ready_to_ship']);
const FINAL = new Set(['delivered', 'not_delivered', 'cancelled', 'returned']);
const TRANSIT = new Set(['shipped', 'in_transit']);
const DISPATCHED_SUBSTATUS = new Set(['picked_up', 'authorized_by_carrier', 'in_hub', 'dropped_off']);
type Stage = 'TODAY' | 'UPCOMING' | 'OVERDUE' | 'TRANSIT' | 'FINISHED' | 'REVIEW' | 'MANAGED';

function id(value: unknown): string | null {
  const candidate = text(value);
  return candidate && /^[1-9]\d{0,39}$/u.test(candidate) ? candidate : null;
}
function iso(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : null;
}
function money(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function shipmentStage(status: string | null, logistic: string | null, deadline: string | null, today: string, substatus: string | null = null): Stage {
  if (status && FINAL.has(status)) return 'FINISHED';
  if ((status && TRANSIT.has(status)) || (status === 'ready_to_ship' && substatus && DISPATCHED_SUBSTATUS.has(substatus))) return 'TRANSIT';
  if (logistic === 'fulfillment') return 'MANAGED';
  if (!status || !PENDING.has(status) || !deadline) return 'REVIEW';
  const day = argentinaDay(new Date(deadline));
  return day < today ? 'OVERDUE' : day === today ? 'TODAY' : 'UPCOMING';
}
export function terminalShipmentDate(raw: Record<string, unknown>, status: string | null): string | null {
  if (!status || !FINAL.has(status) || !isObject(raw.status_history)) return null;
  return iso(raw.status_history['date_' + status]);
}
export function shipmentLogistic(raw: Record<string, unknown>): string | null {
  if (text(raw.logistic_type)) return text(raw.logistic_type);
  return isObject(raw.logistic) ? text(raw.logistic.type) : null;
}
function orderFromApi(raw: Record<string, unknown>) {
  const orderId = id(raw.id);
  const soldAt = iso(raw.date_closed) ?? iso(raw.date_created);
  if (!orderId || !soldAt || (raw.status !== 'paid' && raw.status !== 'cancelled')) return null;
  const shipmentId = isObject(raw.shipping) ? id(raw.shipping.id) : null;
  const lines = (Array.isArray(raw.order_items) ? raw.order_items.filter(isObject) : []).flatMap((line, index) => {
    const item = isObject(line.item) ? line.item : {};
    const quantity = typeof line.quantity === 'number' && Number.isSafeInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0;
    if (!quantity) return [];
    const attrs = Array.isArray(item.variation_attributes) ? item.variation_attributes.filter(isObject) : [];
    const attr = (kind: 'color' | 'size') => text(attrs.find(a => attributeKind(text(a.id), text(a.name)) === kind)?.value_name);
    return [{ key: orderId + ':' + index, itemId: text(item.id), variationId: text(item.variation_id),
      title: text(item.title) ?? 'Producto', sku: text(item.seller_sku) ?? text(item.seller_custom_field),
      color: attr('color'), size: attr('size'), quantity, unitPrice: money(line.unit_price),
      currency: text(line.currency_id) ?? text(raw.currency_id), imageUrl: text(item.thumbnail) }];
  });
  return { orderId, shipmentId, soldAt, lines, cancelled: raw.status === 'cancelled',
    cancelledAt: raw.status === 'cancelled' && isObject(raw.cancel_detail) ? iso(raw.cancel_detail.date) : null,
    completedAt: null as string | null };
}
type LiveOrder = NonNullable<ReturnType<typeof orderFromApi>>;
type ShipmentGroup = { key: string; shipmentId: string | null; orders: LiveOrder[] };
export function groupLiveOrders(orders: LiveOrder[]): ShipmentGroup[] {
  const groups = new Map<string, ShipmentGroup>();
  for (const order of orders) {
    const key = order.cancelled ? 'cancelled:' + order.orderId : order.shipmentId ? 'shipment:' + order.shipmentId : 'order:' + order.orderId;
    const group = groups.get(key) ?? { key, shipmentId: order.shipmentId, orders: [] };
    if (!group.orders.some(existing => existing.orderId === order.orderId)) group.orders.push(order);
    groups.set(key, group);
  }
  return [...groups.values()];
}

@Injectable()
export class MercadolibreShipmentsService {
  private readonly logger = new Logger(MercadolibreShipmentsService.name);
  constructor(private readonly tokens: MercadolibreTokenService, private readonly api: MercadolibreApiService,
    private readonly supabase: SupabaseService, private readonly workspaces: WorkspaceRepository) {}

  async list(userId: string) {
    const started = Date.now();
    const workspace = await this.workspaces.findWorkspaceByUserId(userId);
    return this.tokens.executeWithValidAccessToken(userId, async ({ connection, accessToken }) => {
      const today = argentinaDay(new Date());
      const from = new Date(Date.now() - DAYS * 86400000).toISOString();
      const orders: LiveOrder[] = [];
      let truncated = false;
      let unparsed = 0;
      for (let offset = 0; offset < MAX_ORDERS; offset += PAGE) {
        const params = new URLSearchParams({ seller: String(connection.seller_id), 'order.status': 'paid,cancelled',
          'order.date_created.from': from, sort: 'date_desc', offset: String(offset), limit: String(PAGE) });
        const response = await this.api.get<unknown>('/orders/search?' + params.toString(), accessToken, undefined, { timeoutMs: API_TIMEOUT });
        if (!isObject(response) || !Array.isArray(response.results)) throw new BadGatewayException('Respuesta de órdenes inválida');
        for (const raw of response.results) {
          const order = isObject(raw) ? orderFromApi(raw) : null;
          if (order) orders.push(order); else unparsed++;
        }
        const total = isObject(response.paging) ? money(response.paging.total) : null;
        if (response.results.length < PAGE || (total !== null && offset + PAGE >= total)) break;
        if (offset + PAGE >= MAX_ORDERS) truncated = true;
      }
      const db = this.supabase.getClient();
      // La búsqueda como vendedor puede omitir cancelaciones. Recuperar también
      // los IDs de las cancelaciones que ya registró la integración.
      const { data: cancelledRows, error: cancelledError } = await db.from('recent_sales')
        .select('external_order_id').eq('user_id', connection.user_id)
        .eq('channel', 'MERCADOLIBRE').eq('order_status', 'cancelled')
        .gte('sold_at', from).limit(MAX_ORDERS);
      let cancellationUnavailable = Boolean(cancelledError);
      const existingIds = new Set(orders.map(o => o.orderId));
      const missing = [...new Set((cancelledRows ?? []).map(r => r.external_order_id))]
        .filter(orderId => id(orderId) && !existingIds.has(orderId));
      for (let offset = 0; offset < missing.length; offset += CONCURRENCY) {
        if (Date.now() - started > 15000) { cancellationUnavailable = true; break; }
        const recovered = await Promise.allSettled(missing.slice(offset, offset + CONCURRENCY).map(async orderId => {
          const raw = await this.api.get<unknown>('/orders/' + orderId, accessToken, undefined, { timeoutMs: API_TIMEOUT });
          if (!isObject(raw) || id(raw.id) !== orderId || !isObject(raw.seller) ||
              id(raw.seller.id) !== String(connection.seller_id)) return null;
          return orderFromApi(raw);
        }));
        for (const result of recovered) {
          if (result.status === 'fulfilled' && result.value) orders.push(result.value);
          else cancellationUnavailable = true;
        }
      }
      const ids = [...new Set(orders.map(o => o.orderId))];
      let preparationUnavailable = false;
      for (let offset = 0; offset < ids.length; offset += 50) {
        const batch = ids.slice(offset, offset + 50);
        const [workflow, stored] = await Promise.all([
          db.from('sales_order_workflow').select('external_order_id,completed_at')
            .eq('workspace_id', workspace.id).eq('channel', 'MERCADOLIBRE').in('external_order_id', batch),
          db.from('recent_sales').select('external_order_id,ml_item_id,ml_variation_id,sku,color,size,image_url')
            .eq('user_id', connection.user_id).eq('channel', 'MERCADOLIBRE').in('external_order_id', batch),
        ]);
        if (workflow.error) preparationUnavailable = true;
        for (const order of orders.filter(o => batch.includes(o.orderId))) {
          order.completedAt = workflow.data?.find(w => w.external_order_id === order.orderId)?.completed_at ?? null;
          for (const line of order.lines) {
            const saved = stored.data?.find(s => s.external_order_id === order.orderId && s.ml_item_id === line.itemId && s.ml_variation_id === line.variationId);
            line.sku ??= saved?.sku ?? null; line.color ??= saved?.color ?? null;
            line.size ??= saved?.size ?? null; line.imageUrl ??= saved?.image_url ?? null;
          }
        }
      }
      const groups = groupLiveOrders(orders);
      const resolveGroup = async (group: ShipmentGroup) => {
        let status: string | null = null, substatus: string | null = null, logistic: string | null = null;
        let deadline: string | null = null, slaStatus: string | null = null;
        let issue: string | null = null;
        let terminalAt: string | null = null;
        if (group.orders.every(o => o.cancelled)) {
          status = 'cancelled';
          terminalAt = group.orders.flatMap(o => o.cancelledAt ? [o.cancelledAt] : []).sort().at(-1) ?? null;
          // No consultar SLA de cancelados. Si falta la fecha, intentar leer el historial del envío.
          if (!terminalAt && group.shipmentId && Date.now() - started <= 35000) {
            try {
              const raw = await this.api.get<unknown>('/shipments/' + group.shipmentId, accessToken, undefined, { timeoutMs: API_TIMEOUT, formatNew: true });
              if (isObject(raw)) { terminalAt = terminalShipmentDate(raw, 'cancelled'); logistic = shipmentLogistic(raw); }
            } catch { /* la fecha queda desconocida */ }
          }
        }
        else if (!group.shipmentId) issue = 'Pedido sin ID de envío';
        else if (Date.now() - started > 35000) issue = 'Consulta incompleta por límite de tiempo';
        else {
          try {
            const raw = await this.api.get<unknown>('/shipments/' + group.shipmentId, accessToken, undefined, { timeoutMs: API_TIMEOUT, formatNew: true });
            if (!isObject(raw)) throw new Error('invalid shipment');
            status = text(raw.status); substatus = text(raw.substatus); logistic = shipmentLogistic(raw);
            terminalAt = terminalShipmentDate(raw, status);
            if (status && PENDING.has(status) && logistic !== 'fulfillment' && !(status === 'ready_to_ship' && substatus && DISPATCHED_SUBSTATUS.has(substatus))) {
              try {
                const sla = await this.api.get<unknown>('/shipments/' + group.shipmentId + '/sla', accessToken, undefined, { timeoutMs: API_TIMEOUT });
                if (isObject(sla)) { deadline = iso(sla.expected_date); slaStatus = text(sla.status); }
                if (!deadline) issue = 'Mercado Libre no informó el plazo de despacho';
              } catch { issue = 'No se pudo consultar el SLA'; }
            }
            if (!status) issue = 'Estado de envío no disponible';
          } catch { issue = 'No se pudo consultar el envío'; }
        }
        return { ...group, status, substatus, logistic, deadline, slaStatus, issue, terminalAt,
          stage: shipmentStage(status, logistic, deadline, today, substatus) };
      };
      const shipments: Awaited<ReturnType<typeof resolveGroup>>[] = [];
      for (let i = 0; i < groups.length; i += CONCURRENCY) {
        shipments.push(...await Promise.all(groups.slice(i, i + CONCURRENCY).map(resolveGroup)));
      }
      const failed = shipments.filter(s => s.issue !== null).length;
      this.logger.log('Envíos: ' + orders.length + ' órdenes, ' + shipments.length + ' grupos, ' + failed + ' por revisar');
      return { today, fetchedAt: new Date().toISOString(), days: DAYS, truncated, unparsed, preparationUnavailable, cancellationUnavailable, shipments };
    });
  }

  async complete(userId: string, orderId: string, completed: boolean) {
    const workspace = await this.workspaces.findWorkspaceByUserId(userId);
    await this.tokens.executeWithValidAccessToken(userId, async ({ connection, accessToken }) => {
      const order = await this.api.get<unknown>('/orders/' + orderId, accessToken, undefined, { timeoutMs: API_TIMEOUT });
      if (!isObject(order) || id(order.id) !== orderId || order.status !== 'paid' ||
          !isObject(order.seller) || id(order.seller.id) !== String(connection.seller_id)) {
        throw new BadRequestException('Pedido no disponible para esta cuenta');
      }
      const { error } = await this.supabase.getClient().from('sales_order_workflow').upsert({
        workspace_id: workspace.id, channel: 'MERCADOLIBRE', external_order_id: orderId,
        completed_at: completed ? new Date().toISOString() : null, completed_by: completed ? userId : null,
      }, { onConflict: 'workspace_id,channel,external_order_id' });
      if (error) throw new ServiceUnavailableException('No se pudo guardar la preparación');
    });
    return { ok: true };
  }
}

@Controller('sales/shipments')
@UseGuards(AccessTokenGuard)
export class MercadolibreShipmentsController {
  constructor(private readonly shipments: MercadolibreShipmentsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: SafeUser) { return this.shipments.list(user.id); }
  @Post('complete')
  complete(@CurrentUser() user: SafeUser, @Body() value: unknown) {
    if (!isObject(value) || typeof value.completed !== 'boolean' || !id(value.orderId)) throw new BadRequestException('Pedido inválido');
    return this.shipments.complete(user.id, id(value.orderId)!, value.completed);
  }
}
