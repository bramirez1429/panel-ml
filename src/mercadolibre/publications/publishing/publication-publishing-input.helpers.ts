import { BadRequestException } from '@nestjs/common';

export function list(
  value: unknown,
  field: string,
  maximum: number,
): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new BadRequestException(
      `${field} debe ser un array de hasta ${maximum} elementos`,
    );
  }
  return value;
}

export function record(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

export function assertKeys(
  input: Record<string, unknown>,
  allowed: Set<string>,
  field: string,
): void {
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new BadRequestException(
      `${field} contiene campos no admitidos: ${unexpected.join(', ')}`,
    );
  }
}

export function identifier(
  value: unknown,
  field: string,
  pattern: RegExp,
): string {
  const result = text(value, field, 255);
  if (!pattern.test(result)) {
    throw new BadRequestException(`${field} es invalido`);
  }
  return result;
}

export function text(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > maximum
  ) {
    throw new BadRequestException(`${field} es invalido`);
  }
  return value.trim();
}

export function optionalText(
  value: unknown,
  field: string,
  maximum: number,
): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, field, maximum);
}

export function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BadRequestException(`${field} debe ser mayor que cero`);
  }
  return value;
}

export function quantity(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException(
      `${field} debe ser un entero mayor o igual que cero`,
    );
  }
  return value;
}

export function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${field} debe ser boolean`);
  }
  return value;
}
