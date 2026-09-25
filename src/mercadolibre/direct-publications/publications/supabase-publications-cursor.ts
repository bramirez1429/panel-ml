import { BadRequestException } from '@nestjs/common';

const PREFIX = 'supabase-publications:v1:';

export function encodeSupabasePublicationsCursor(offset: number): string {
  return `${PREFIX}${Buffer.from(JSON.stringify({ offset })).toString('base64url')}`;
}

export function decodeSupabasePublicationsCursor(cursor?: string): number {
  if (!cursor?.trim()) return 0;
  if (!cursor.startsWith(PREFIX)) invalidCursor();

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor.slice(PREFIX.length), 'base64url').toString('utf8'),
    ) as { offset?: unknown };
    if (!Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0) {
      invalidCursor();
    }
    return Number(parsed.offset);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    invalidCursor();
  }
}

function invalidCursor(): never {
  throw new BadRequestException('cursor de publicaciones inválido');
}
