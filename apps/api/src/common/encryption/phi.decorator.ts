import 'reflect-metadata';

/**
 * Marks a class property as a Protected Health Information field. Consumed by
 * the Prisma encryption extension (Phase B+) and surfaced to Semgrep linting
 * rules that ensure no PHI is written without `@PHI()` annotation.
 */
export const PHI_METADATA_KEY = Symbol('quantumed:phi');

export function PHI(): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: PropertyKey[] = Reflect.getMetadata(PHI_METADATA_KEY, target.constructor) ?? [];
    if (!existing.includes(propertyKey)) {
      existing.push(propertyKey);
      Reflect.defineMetadata(PHI_METADATA_KEY, existing, target.constructor);
    }
  };
}

export function getPhiFields(cls: object): PropertyKey[] {
  return Reflect.getMetadata(PHI_METADATA_KEY, cls) ?? [];
}
