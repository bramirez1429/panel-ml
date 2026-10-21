import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { BulkEditChanges } from './tiendanube-bulk-edit.types';
import { TiendanubeBulkEditService } from './tiendanube-bulk-edit.service';
@Controller(['tiendanube/bulk-edit','tiendanube/bulk-edition']) @UseGuards(AccessTokenGuard)
export class TiendanubeBulkEditController {
  constructor(private readonly service:TiendanubeBulkEditService){}
  @Get('categories') categories(@CurrentUser() u:SafeUser){return this.service.categoriesByUser(u.id);}
  @Get('categories/:categoryId/summary') summary(@CurrentUser() u:SafeUser,@Param('categoryId') categoryId:string){return this.service.summary(u.id,categoryId);}
  @Post('preview') preview(@CurrentUser() u:SafeUser,@Body() b:{categoryId?:unknown;changes?:unknown}){return this.service.preview(u.id,{categoryId:categoryId(b.categoryId),changes:changes(b.changes)});}
  @Post('jobs') create(@CurrentUser() u:SafeUser,@Body() b:{snapshotId?:unknown}){return this.service.createJob(u.id,uuid(b.snapshotId));}
  @Get('jobs/active') active(@CurrentUser() u:SafeUser){return this.service.activeJob(u.id);}
  @Get('jobs/:jobId') job(@CurrentUser() u:SafeUser,@Param('jobId',ParseUUIDPipe) id:string){return this.service.getJob(u.id,id);}
  @Get('jobs/:jobId/failures') failures(@CurrentUser() u:SafeUser,@Param('jobId',ParseUUIDPipe) id:string){return this.service.failures(u.id,id);}
  @Post('jobs/:jobId/retry-failures') retry(@CurrentUser() u:SafeUser,@Param('jobId',ParseUUIDPipe) id:string){return this.service.retryFailures(u.id,id);}
}
function categoryId(v:unknown){if(typeof v!=='string'||!/^\d+$/u.test(v))throw new BadRequestException('categoryId inválido');return v;}function uuid(v:unknown){if(typeof v!=='string')throw new BadRequestException('snapshotId inválido');return v;}function changes(v:unknown):BulkEditChanges{if(!v||typeof v!=='object'||Array.isArray(v))throw new BadRequestException('changes inválidos');const x=v as Record<string,unknown>;return {...decimal(x.price,'price'),...decimal(x.promotionalPrice,'promotionalPrice'),...(typeof x.stock==='number'?{stock:x.stock}:{}),...(typeof x.locationId==='string'?{locationId:x.locationId}:{})};}function decimal(v:unknown,k:'price'|'promotionalPrice'):Partial<BulkEditChanges>{if(v===undefined||v===null||v==='')return{};if(typeof v!=='string'&&typeof v!=='number')throw new BadRequestException(`${k} inválido`);return k==='price'?{price:String(v).trim().replace(',','.')}:{promotionalPrice:String(v).trim().replace(',','.')};}
