import { randomUUID } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/core/db';
import { requireMember } from '@/core/guards/api-auth';
import { requireAccount } from '@/core/guards/require-account';
import { badRequest, notFound, rateLimitResponse, serverError } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import {
	PRIVATE_IMAGE_MAX_BYTES,
	PRIVATE_IMAGE_MIME_TYPES,
} from '@/core/infra/private-image-policy';
import {
	createSupabaseSignedUpload,
	ImageStorageConfigurationError,
} from '@/core/infra/supabase-storage';
import { checkRateLimit, uploadSignDayLimiter, uploadSignLimiter } from '@/core/rate-limit';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { getPrivateImageUrl } from '@/core/validators/image-url';

const ALLOWED_PURPOSES = ['expense', 'announcement'] as const;
const MAX_SIGN_BODY_BYTES = 16 * 1024;

const signSchema = z.object({
	shareCode: z.string().transform((v) => normalizeShareCode(v)),
	purpose: z.enum(ALLOWED_PURPOSES),
	mimeType: z.enum(PRIVATE_IMAGE_MIME_TYPES),
	fileSize: z.number().int().positive().max(PRIVATE_IMAGE_MAX_BYTES),
});

function noStore<T extends NextResponse>(response: T): T {
	response.headers.set('Cache-Control', 'no-store');
	return response;
}

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
	const parsed = await parseBody(req, signSchema, {
		maxBytes: MAX_SIGN_BODY_BYTES,
		fieldErrors: {
			shareCode: 'invalid_share_code',
			purpose: 'invalid_purpose',
			mimeType: 'invalid_mime_type',
			fileSize: 'file_too_large',
		},
	});
	if (!parsed.ok) return noStore(parsed.response);

	const { shareCode: code, purpose, mimeType } = parsed.data;
	if (!isValidShareCode(code)) return noStore(badRequest('invalid_share_code'));

	const account = await requireAccount(req, 'upload sign');
	if (!account.ok) return noStore(account.response);
	const authenticatedUser = account.user;

	const wg = await db.query.wgs.findFirst({
		where: (w, { eq }) => eq(w.shareCode, code),
		columns: { id: true },
	});
	if (!wg) return noStore(notFound('wg_not_found'));

	const auth = await requireMember(req, wg.id, authenticatedUser);
	if (!auth.ok) {
		return noStore(auth.response.status === 401 ? notFound('wg_not_found') : auth.response);
	}

	const limited =
		rateLimitResponse(
			await checkRateLimit(uploadSignLimiter, `${wg.id}:${auth.member.memberId}`),
			'upload_sign_rate_limited',
			'upload_sign_rate_limited',
		) ??
		rateLimitResponse(
			await checkRateLimit(uploadSignDayLimiter, wg.id),
			'upload_sign_rate_limited',
			'upload_sign_rate_limited',
		);
	if (limited) return noStore(limited);

	try {
		const ext = extFromMime(mimeType);
		const key = `manawg/${wg.id}/${purpose}/${randomUUID()}.${ext}`;
		const signature = {
			...(await createSupabaseSignedUpload(key, mimeType)),
			publicUrl: getPrivateImageUrl(key),
		};
		return noStore(NextResponse.json(signature));
	} catch (err) {
		if (err instanceof ImageStorageConfigurationError) {
			return noStore(
				NextResponse.json(
					{ error: 'feature_disabled', code: 'image_uploads_unavailable' },
					{ status: 503 },
				),
			);
		}
		return noStore(serverError('sign_failed'));
	}
}
