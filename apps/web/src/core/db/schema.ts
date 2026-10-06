/**
 * Drizzle schema, one module per domain under `./schema/`. This barrel is the public entry
 * (`@/core/db`, `@/core/db/schema`) and the `schema` object the drizzle client is built with.
 */
export * from './schema/calendar';
export * from './schema/chat';
export * from './schema/expenses';
export * from './schema/household';
export * from './schema/limits';
export * from './schema/pinnwand';
export * from './schema/relations';
export * from './schema/system';
export * from './schema/wg';
