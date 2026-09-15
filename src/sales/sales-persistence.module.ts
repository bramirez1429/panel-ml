import { Module } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { RecentSalesRepository } from './recent-sales.repository';
import { SupabaseRecentSalesRepository } from './supabase-recent-sales.repository';
import { SupabaseVariantChannelLinksRepository } from './supabase-variant-channel-links.repository';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

@Module({
  providers: [
    SupabaseService,
    { provide: RecentSalesRepository, useClass: SupabaseRecentSalesRepository },
    {
      provide: VariantChannelLinksRepository,
      useClass: SupabaseVariantChannelLinksRepository,
    },
  ],
  exports: [RecentSalesRepository, VariantChannelLinksRepository],
})
export class SalesPersistenceModule {}
