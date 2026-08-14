import { BadRequestException } from '@nestjs/common';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';

export type ScopedTextInput = Readonly<{
  itemId: unknown;
  value: string;
}>;

export type PublicationAttributeUpdate = Readonly<{
  id: string;
  valueId: string | null;
  valueName: string | null;
  clear: boolean;
}>;

export type ScopedAttributesInput = Readonly<{
  itemId: unknown;
  attributes: PublicationAttributeUpdate[];
}>;

export function parseScopedText(
  body: unknown,
  field: 'title' | 'description',
  maxLength: number,
  allowEmpty = false,
): ScopedTextInput {
  if (!isJsonObject(body) || typeof body[field] !== 'string') {
    throw new BadRequestException(field + ' es obligatorio');
  }
  const value = body[field].trim();
  if (!allowEmpty && !value) {
    throw new BadRequestException(field + ' no puede quedar vacio');
  }
  if (value.length > maxLength) {
    throw new BadRequestException(
      field + ' admite hasta ' + maxLength + ' caracteres',
    );
  }
  return { itemId: body.itemId, value };
}

export function parseScopedAttributes(body: unknown): ScopedAttributesInput {
  if (!isJsonObject(body) || !Array.isArray(body.attributes)) {
    throw new BadRequestException('attributes debe ser un arreglo');
  }
  if (body.attributes.length === 0 || body.attributes.length > 100) {
    throw new BadRequestException(
      'attributes debe contener entre 1 y 100 elementos',
    );
  }
  const attributes = body.attributes.map(parseAttributeUpdate);
  if (new Set(attributes.map(({ id }) => id)).size !== attributes.length) {
    throw new BadRequestException('No se pueden repetir atributos');
  }
  return { itemId: body.itemId, attributes };
}

function parseAttributeUpdate(value: unknown): PublicationAttributeUpdate {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value.id) ||
    value.id.trim().length > 100
  ) {
    throw new BadRequestException('Hay un atributo invalido');
  }
  const valueId = nullableText(value.valueId);
  const valueName = nullableText(value.valueName);
  const clear = value.valueId === null && value.valueName === null;
  if (!clear && !valueId && !valueName) {
    throw new BadRequestException(
      'El atributo ' + value.id.trim() + ' no tiene valor',
    );
  }
  return {
    id: value.id.trim().toUpperCase(),
    valueId,
    valueName,
    clear,
  };
}

function nullableText(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}
