import {
  BadRequestException, Body, ConflictException, Controller, Get, Header,
  Injectable, NotFoundException, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/domain/auth.models';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import type { RecentSaleChannel, RecentSaleRow } from '../database/database.types';
import { SupabaseService } from '../database/supabase.service';
import { WorkspaceRepository } from '../workspaces/workspace.repository';
import { isObject } from './variant-normalization';

const ZONE = 'America/Argentina/Buenos_Aires';
const WINDOW_DAYS = 31;
const PAGE_SIZE = 500;
const MAX_LINES = 10000;

type OrderKey = { channel: RecentSaleChannel; orderId: string };
type Context = { workspaceId: string; userId: string; memberIds: string[] };
type Workflow = { channel: RecentSaleChannel; external_order_id: string; completed_at: string | null; completed_by: string | null };
type Read = { channel: RecentSaleChannel; external_order_id: string };

export function argentinaDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return [part('year'), part('month'), part('day')].join('-');
}

export function groupOrders(rows: RecentSaleRow[], workflows: Workflow[], reads: Read[]) {
  const key = (channel: RecentSaleChannel, orderId: string) => channel + ':' + orderId;
  const groups = new Map<string, RecentSaleRow[]>();
  for (const row of rows) {
    const id = key(row.channel, row.external_order_id);
    const current = groups.get(id) ?? [];
    current.push(row);
    groups.set(id, current);
  }
  const workflowMap = new Map(workflows.map((row) => [key(row.channel,row.external_order_id),row]));
  const seen = new Set(reads.map((row) => key(row.channel,row.external_order_id)));
  return [...groups.entries()].flatMap(([id, lines]) => {
    const first = lines[0];
    if (!first) return [];
    const workflow = workflowMap.get(id);
    const cancelled = lines.some((line) => line.order_status === 'cancelled');
    const completed = !cancelled && Boolean(workflow?.completed_at);
    const status = cancelled ? 'CANCELLED' as const : completed ? 'COMPLETED' as const : 'PENDING' as const;
    const unique = [...new Map(lines.map((line) => [line.external_order_item_id,line])).values()];
    const currency = first.currency ?? null;
    const amount = currency && unique.every((line) =>
      line.currency === currency && typeof line.unit_price === 'number' && Number.isFinite(line.unit_price),
    ) ? unique.reduce((total,line) => total + (line.unit_price ?? 0) * line.quantity,0) : null;
    return [{
      channel: first.channel, orderId: first.external_order_id,
      soldAt: first.sold_at,
      status, buyer: first.buyer_name ?? null, shippingStatus: first.shipping_status ?? null,
      completedAt: completed ? workflow?.completed_at ?? null : null,
      completedBy: completed ? workflow?.completed_by ?? null : null,
      unread: !cancelled && !seen.has(id),
      quantity: unique.reduce((total,line) => total + line.quantity,0),
      amount, currency,
      lines: unique.map((line) => ({
        id: line.id, productName: line.product_name, sku: line.sku,
        quantity: line.quantity, color: line.color, size: line.size,
        imageUrl: line.image_url ?? null, unitPrice: line.unit_price ?? null,
        mlItemId: line.ml_item_id, tnProductId: line.tn_product_id,
      })),
    }];
  }).sort((a,b) => b.soldAt.localeCompare(a.soldAt));
}

@Injectable()
export class SalesOperationsService {
  constructor(private readonly supabase: SupabaseService, private readonly workspaces: WorkspaceRepository) {}

  private async context(userId: string): Promise<Context> {
    const workspace = await this.workspaces.findWorkspaceByUserId(userId);
    const { data,error } = await this.supabase.getClient().from('workspace_members')
      .select('user_id').eq('workspace_id',workspace.id);
    if (error || !data) this.unavailable();
    return { userId,workspaceId: workspace.id,memberIds: data.map((row) => row.user_id) };
  }

  async list(userId: string) {
    const ctx = await this.context(userId);
    const now = new Date();
    const today = argentinaDay(now);
    const from = new Date(now.getTime() - (WINDOW_DAYS - 1) * 86400000);
    const since = new Date(argentinaDay(from) + 'T00:00:00-03:00').toISOString();
    const db = this.supabase.getClient();
    const rows: RecentSaleRow[] = [];
    for (let offset=0; offset<MAX_LINES; offset+=PAGE_SIZE) {
      const {data,error} = await db.from('recent_sales').select('*')
        .in('user_id',ctx.memberIds).gte('sold_at',since)
        .order('sold_at',{ascending:false}).order('id',{ascending:true})
        .range(offset,offset+PAGE_SIZE-1);
      if(error || !data) this.unavailable();
      rows.push(...data);
      if(data.length<PAGE_SIZE) break;
      if(offset+PAGE_SIZE>=MAX_LINES) this.unavailable();
    }
    // Consultar sólo los pedidos del período, en lotes acotados.
    const ids = [...new Set(rows.map((row) => row.external_order_id))];
    const workflows: Workflow[] = [];
    const reads: Read[] = [];
    for (let offset=0; offset<ids.length; offset+=100) {
      const batch=ids.slice(offset,offset+100);
      const [w,r]=await Promise.all([
        db.from('sales_order_workflow').select('channel,external_order_id,completed_at,completed_by')
          .eq('workspace_id',ctx.workspaceId).in('external_order_id',batch),
        db.from('sales_notification_reads').select('channel,external_order_id')
          .eq('workspace_id',ctx.workspaceId).eq('user_id',userId).in('external_order_id',batch),
      ]);
      if(w.error || r.error || !w.data || !r.data) this.unavailable();
      workflows.push(...w.data); reads.push(...r.data);
    }
    const orders=groupOrders(rows,workflows,reads);
    const todays=orders.filter((order) => argentinaDay(new Date(order.soldAt))===today);
    return { today, days: WINDOW_DAYS, orders, summary: {
      sales: todays.filter((order)=>order.status!=='CANCELLED').length,
      pending: todays.filter((order)=>order.status==='PENDING').length,
      completed: todays.filter((order)=>order.status==='COMPLETED').length,
      cancelled: todays.filter((order)=>order.status==='CANCELLED').length,
      ml: todays.filter((order)=>order.channel==='MERCADOLIBRE'&&order.status!=='CANCELLED').length,
      tn: todays.filter((order)=>order.channel==='TIENDANUBE'&&order.status!=='CANCELLED').length,
      unread: orders.filter((order)=>order.unread).length,
    }};
  }

  async complete(userId: string, key: OrderKey, completed: boolean) {
    const ctx = await this.context(userId);
    const rows=await this.verifyOrder(ctx,key);
    if(rows.some((row)=>row.order_status==='cancelled')) throw new ConflictException('La venta está cancelada');
    const {error}=await this.supabase.getClient().from('sales_order_workflow').upsert({
      workspace_id:ctx.workspaceId, channel:key.channel, external_order_id:key.orderId,
      completed_at:completed?new Date().toISOString():null, completed_by:completed?userId:null,
    },{onConflict:'workspace_id,channel,external_order_id'});
    if(error) this.unavailable();
    return {ok:true};
  }

  async read(userId:string,key:OrderKey) {
    const ctx=await this.context(userId);
    await this.verifyOrder(ctx,key);
    const {error}=await this.supabase.getClient().from('sales_notification_reads').upsert({
      user_id:userId,workspace_id:ctx.workspaceId,channel:key.channel,external_order_id:key.orderId,
      read_at:new Date().toISOString(),
    },{onConflict:'user_id,workspace_id,channel,external_order_id'});
    if(error) this.unavailable();
    return {ok:true};
  }

  private async verifyOrder(ctx:Context,key:OrderKey) {
    const {data,error}=await this.supabase.getClient().from('recent_sales')
      .select('order_status').in('user_id',ctx.memberIds)
      .eq('channel',key.channel).eq('external_order_id',key.orderId);
    if(error || !data) this.unavailable();
    if(!data.length) throw new NotFoundException('Pedido no encontrado');
    return data;
  }

  private unavailable(): never {
    throw new ServiceUnavailableException('No se pudo consultar o guardar la gestión de ventas');
  }
}

function parseKey(value:unknown):OrderKey {
  if(!isObject(value) || (value.channel!=='MERCADOLIBRE'&&value.channel!=='TIENDANUBE') ||
    typeof value.orderId!=='string' || !/^[1-9]\d{0,39}$/u.test(value.orderId)) {
    throw new BadRequestException('Pedido inválido');
  }
  return {channel:value.channel,orderId:value.orderId};
}

@Controller('sales/operations')
@UseGuards(AccessTokenGuard)
export class SalesOperationsController {
  constructor(private readonly operations:SalesOperationsService) {}

  @Get()
  @Header('Cache-Control','no-store')
  list(@CurrentUser() user:SafeUser) {
    return this.operations.list(user.id);
  }

  @Post('complete')
  complete(@CurrentUser() user:SafeUser,@Body() value:unknown) {
    const key=parseKey(value);
    if(!isObject(value)||typeof value.completed!=='boolean') throw new BadRequestException('Estado inválido');
    return this.operations.complete(user.id,key,value.completed);
  }

  @Post('read')
  read(@CurrentUser() user:SafeUser,@Body() value:unknown) {
    return this.operations.read(user.id,parseKey(value));
  }
}
