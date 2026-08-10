import { Injectable } from '@nestjs/common';
import {
  MercadoLibrePublication,
  PublicationModel,
} from '../publication.types';

@Injectable()
export class PublicationModelDetectorService {
  /** Detecta el modelo usando únicamente family_name. */
  detect(publication: MercadoLibrePublication): PublicationModel {
    return typeof publication.family_name === 'string' &&
      publication.family_name.trim().length > 0
      ? 'VARIANT_PRICING'
      : 'SHARED';
  }
}
