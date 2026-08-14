import { HttpException, Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../publication.constants';
import { mapWithConcurrency } from '../sync/publication-sync.helpers';
import { PublicationPublishingPlannerService } from './publication-publishing-planner.service';
import { PublishingPlan } from './publication-publishing.types';
import {
  conditionalAttributeIssues,
  conditionalAttributesPath,
  ValidationIssue,
  validationIssues,
} from './publication-validation.helpers';

@Injectable()
export class PublicationValidationService {
  constructor(
    private readonly planner: PublicationPublishingPlannerService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Valida el formulario completo y sus payloads contra Mercado Libre. */
  async validate(body: unknown) {
    return this.validatePlan(await this.planner.plan(body));
  }

  /** Consulta requisitos condicionales y valida el mismo payload a publicar. */
  async validatePlan(plan: PublishingPlan) {
    const groups = await mapWithConcurrency(
      plan.items.map((item, index) => ({ item, index })),
      PUBLICATION_REQUEST_CONCURRENCY,
      ({ item, index }) =>
        this.validateItem(item.payload, index, plan.context.accessToken),
    );
    const issues = groups.flat();
    return {
      valid: issues.length === 0,
      issues,
      preview: {
        publishingModel: plan.model,
        itemCount: plan.items.length,
        items: plan.items.map(({ payload }, index) => ({ index, payload })),
      },
    };
  }

  private async validateItem(
    payload: Record<string, unknown>,
    index: number,
    accessToken: string,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    try {
      const response = await this.apiService.post<unknown>(
        conditionalAttributesPath(payload),
        payload,
        accessToken,
        'validation',
      );
      issues.push(...conditionalAttributeIssues(response, payload, index));
    } catch (error) {
      issues.push(...this.captureBadRequest(error, index));
    }
    try {
      await this.apiService.post<unknown>(
        '/items/validate',
        payload,
        accessToken,
        'validation',
      );
    } catch (error) {
      issues.push(...this.captureBadRequest(error, index));
    }
    return issues;
  }

  private captureBadRequest(error: unknown, index: number): ValidationIssue[] {
    if (!(error instanceof HttpException) || error.getStatus() !== 400) {
      throw error;
    }
    return validationIssues(error.getResponse(), index);
  }
}
