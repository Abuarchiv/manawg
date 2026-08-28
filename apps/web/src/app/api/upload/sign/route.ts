import { randomUUID } from 'node:crypto';
import { requireMember } from '@/lib/api-auth';
import { badRequest, notFound, serverError, tooMany } from '@/lib/api-error';
import { db } from '@/lib/db';
import { checkRateLimit, uploadSignLimiter } from '@/lib/rate-limit';
import { S3_MAX_UPLOAD_BYTES, createPresignedUpload, isAllowedMimeType } from '@/lib/s3';
import { isValidShareCode, normalizeShareCode } from '@manawg/shared/lib/share-code';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const ALLOWED_PURPOSES = ['expense', 'announcement'] as const;

const signSchema = z.object({
	shareCode: z.string().transform((v) => normalizeShareCode(v)),
	purpose: z.enum(ALLOWED_PURPOSES),
	mimeType: z.string(),
	fileSize: z.number().int().positive().max(S3_MAX_UPLOAD_BYTES),
});

function extFromMime(mime: string): string {
	const map: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/heic': 'heic',
		'image/heif': 'heif',
	};
	return map[mime] ?? 'jpg';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = signSchema.safeParse(raw);
	if (!parsed.success) {
		const issues = parsed.error.flatten();
		if (issues.fieldErrors.shareCode) return badRequest('invalid_share_code');
		if (issues.fieldErrors.purpose) return badRequest('invalid_purpose');
		if (issues.fieldErrors.mimeType) return badRequest('invalid_mime_type');
		if (issues.fieldErrors.fileSize) return badRequest('file_too_large');
		return badRequest('invalid_body');
	}

	const { shareCode: code, purpose, mimeType, fileSize } = parsed.data;
	if (!isValidShareCode(code)) return badRequest('invalid_share_code');
	if (!isAllowedMimeType(mimeType)) return badRequest('invalid_mime_type');

	const wg = await db.query.wgs.findFirst({
		where: (w, { eq }) => eq(w.shareCode, code),
		columns: { id: true },
	});
	if (!wg) return notFound('wg_not_found');

	const auth = await requireMember(req, wg.id);
	if (!auth.ok) return auth.response;

	const limited = await checkRateLimit(uploadSignLimiter, `${wg.id}:${auth.member.memberId}`);
	if (!limited.success) {
		return tooMany('upload_sign_rate_limited', 'upload_sign_rate_limited');
	}

	try {
		const ext = extFromMime(mimeType);
		const key = `manawg/${wg.id}/${purpose}/${randomUUID()}.${ext}`;
		const signature = await createPresignedUpload(key, mimeType, fileSize);
		return NextResponse.json(signature);
	} catch (err) {
		const isConfigMissing =
			err instanceof Error &&
			(err.message.includes('S3 credentials missing') ||
				err.message.includes('S3_BUCKET') ||
				err.message.includes('S3_PUBLIC_URL'));
		if (isConfigMissing) {
			return NextResponse.json(
				{ error: 'feature_disabled', code: 'image_uploads_unavailable' },
				{ status: 503 },
			);
		}
		console.error('[upload/sign]', err);
		return serverError('sign_failed');
	}
}
