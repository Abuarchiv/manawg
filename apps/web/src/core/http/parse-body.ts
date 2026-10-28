import type { NextResponse } from 'next/server';
import type { z } from 'zod';
import { badRequest, payloadTooLarge } from '@/core/http/api-errors';
import { DEFAULT_JSON_BODY_BYTES, readJsonBody } from '@/core/http/read-json';

/** An error code, or a function choosing one from the field's issue messages in order. */
type FieldErrorCode = string | ((messages: string[]) => string);

interface ParseBodyOptions {
	/**
	 * Field-specific error codes, checked in insertion order: the first field
	 * with a validation issue answers `400 <code>`. Any other issue answers
	 * `400 <invalid>`.
	 */
	fieldErrors?: Readonly<Record<string, FieldErrorCode>>;
	/**
	 * Codes for object-level refinement messages (issues without a field path),
	 * checked after `fieldErrors` unless `formErrorsFirst` is set.
	 */
	formErrors?: Readonly<Record<string, string>>;
	formErrorsFirst?: boolean;
	/** Error for a body that fails validation outside `fieldErrors`. Default `invalid_body`. */
	invalid?: string;
	/** Byte cap for the body. Default {@link DEFAULT_JSON_BODY_BYTES}. */
	maxBytes?: number;
}

export type ParseBodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

function issueCode(issues: z.ZodIssue[], options: ParseBodyOptions): string {
	const formMessages = new Set(
		issues.filter((issue) => issue.path.length === 0).map((issue) => issue.message),
	);
	const formCode = (): string | null => {
		for (const [message, code] of Object.entries(options.formErrors ?? {})) {
			if (formMessages.has(message)) return code;
		}
		return null;
	};
	const fieldCode = (): string | null => {
		for (const [field, code] of Object.entries(options.fieldErrors ?? {})) {
			const messages = issues
				.filter((issue) => issue.path[0] === field)
				.map((issue) => issue.message);
			if (messages.length > 0) return typeof code === 'string' ? code : code(messages);
		}
		return null;
	};
	const code = options.formErrorsFirst ? (formCode() ?? fieldCode()) : (fieldCode() ?? formCode());
	return code ?? options.invalid ?? 'invalid_body';
}

/**
 * Read a JSON body under a byte cap and validate it against `schema`.
 *
 * Error responses match the hand-written route ladders: 413
 * `payload_too_large` for an oversized body, 400 `invalid_json` for an
 * unreadable one, the first matching `fieldErrors`/`formErrors` code, else 400
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
	return { ok: false, response: badRequest(issueCode(parsed.error.issues, options)) };
}
