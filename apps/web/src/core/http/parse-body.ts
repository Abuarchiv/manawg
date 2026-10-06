import { badRequest, payloadTooLarge } from '@/core/http/api-errors';
import { DEFAULT_JSON_BODY_BYTES, readJsonBody } from '@/core/http/read-json';
import type { NextResponse } from 'next/server';
import type { z } from 'zod';

interface ParseBodyOptions {
	/**
	 * Field-specific error codes, checked in insertion order: the first field
	 * with a validation issue answers `400 <code>`. Any other issue answers
	 * `400 <invalid>`.
	 */
	fieldErrors?: Readonly<Record<string, string>>;
	/** Error for a body that fails validation outside `fieldErrors`. Default `invalid_body`. */
	invalid?: string;
	/** Byte cap for the body. Default {@link DEFAULT_JSON_BODY_BYTES}. */
	maxBytes?: number;
}

export type ParseBodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Read a JSON body under a byte cap and validate it against `schema`.
 *
 * Error responses match the hand-written route ladders: 413
 * `payload_too_large` for an oversized body, 400 `invalid_json` for an
 * unreadable one, the first matching `fieldErrors` code, else 400
 * `invalid_body` (or `options.invalid`).
 */
export async function parseBody<S extends z.ZodTypeAny>(
	req: Request,
	schema: S,
	options: ParseBodyOptions = {},
): Promise<ParseBodyResult<z.output<S>>> {
	const raw = await readJsonBody(req, options.maxBytes ?? DEFAULT_JSON_BODY_BYTES);
	if (!raw.ok) {
		return {
			ok: false,
			response: raw.reason === 'payload_too_large' ? payloadTooLarge() : badRequest('invalid_json'),
		};
	}
	const parsed = schema.safeParse(raw.body);
	if (parsed.success) return { ok: true, data: parsed.data };

	const failedFields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
	for (const [field, code] of Object.entries(options.fieldErrors ?? {})) {
		if (failedFields.has(field)) return { ok: false, response: badRequest(code) };
	}
	return { ok: false, response: badRequest(options.invalid ?? 'invalid_body') };
}
