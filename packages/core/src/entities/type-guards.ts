import type { BaseEntity, Character, Place, ObjectEntity } from '@dmnpc/types/entity';
import type { UniverseEvent } from '@dmnpc/types/entity';

export function isCharacter(entity: BaseEntity | UniverseEvent): entity is Character {
  return 'entityType' in entity && entity.entityType === 'character';
}

export function isPlace(entity: BaseEntity | UniverseEvent): entity is Place {
  return 'entityType' in entity && entity.entityType === 'place';
}

export function isObjectEntity(entity: BaseEntity | UniverseEvent): entity is ObjectEntity {
  return 'entityType' in entity && entity.entityType === 'object';
}

export function isUniverseEvent(entity: { id: string }): entity is UniverseEvent {
  return entity.id.startsWith('EVENT_');
}

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
