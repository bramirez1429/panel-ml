import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';
import { MercadoLibrePictureUploadService } from './mercadolibre-picture-upload.service';
import { SimilarPublicationBase64UploadService } from './similar-publication-base64-upload.service';
import { SimilarPublicationCreationService } from './similar-publication-creation.service';
import { SimilarPublicationSourceService } from './similar-publication-source.service';
import type { SimilarPublicationUploadFile } from './similar-publication.types';

@Controller('mercadolibre/direct/publicar-similar')
@UseGuards(AccessTokenGuard)
export class SimilarPublicationController {
  constructor(
    private readonly sourceService: SimilarPublicationSourceService,
    private readonly pictureUploadService: MercadoLibrePictureUploadService,
    private readonly creationService: SimilarPublicationCreationService,
    private readonly base64UploadService: SimilarPublicationBase64UploadService,
  ) {}

  @Get('draft')
  getDraft(
    @CurrentUser() user: SafeUser,
    @Query('sourceKey') sourceKey?: string,
  ) {
    return this.sourceService.getDraft(user.id, sourceKey ?? '');
  }

  @Post('pictures')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  uploadPicture(
    @CurrentUser() user: SafeUser,
    @UploadedFile() file?: SimilarPublicationUploadFile,
  ) {
    return this.pictureUploadService.upload(user.id, file);
  }

  @Post('pictures/base64')
  uploadBase64Picture(@CurrentUser() user: SafeUser, @Body() input: unknown) {
    return this.base64UploadService.upload(user.id, input);
  }

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() input: unknown) {
    return this.creationService.create(user.id, input);
  }
}
