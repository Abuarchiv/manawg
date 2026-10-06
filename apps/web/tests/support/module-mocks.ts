import { mock } from 'node:test';

/**
 * Mocks `specifier` with its real exports plus `overrides`. Every importer of the module sees the
 * mock, so exports a test does not replace must stay real for the importers that use them.
 */
export async function mockModuleWithReal(
	specifier: string,
	overrides: Record<string, unknown>,
): Promise<void> {
	const { default: _default, ...real } = (await import(specifier)) as Record<string, unknown>;
	mock.module(specifier, { namedExports: { ...real, ...overrides } });
}
