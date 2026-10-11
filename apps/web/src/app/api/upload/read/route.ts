import { isPrivateImageKeyRevoked } from '@/core/db/private-image-deletions';
import { requireMember } from '@/core/guards/api-auth';
import { requireAccount } from '@/core/guards/require-account';
import { badRequest, notFound, serverError } from '@/core/http/api-errors';
import {
	ImageStorageConfigurationError,
	ImageStorageObjectNotFoundError,
	downloadSupabaseImage,
} from '@/core/infra/supabase-storage';
import { parsePrivateImageKey } from '@/core/validators/image-url';
import { type NextRequest, NextResponse } from 'next/server';

function noStore<T extends NextResponse>(response: T): T {
	response.headers.set('Cache-Control', 'no-store');
	return response;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
	const key = req.nextUrl.searchParams.get('key');
	const privateImage = key ? parsePrivateImageKey(key) : null;
	if (!key || !privateImage) return noStore(badRequest('invalid_image_key'));

	const account = await requireAccount(req, 'upload read');
	if (!account.ok) return noStore(account.response);
	const authenticatedUser = account.user;

	const auth = await requireMember(req, privateImage.wgId, authenticatedUser);
	if (!auth.ok) return noStore(auth.response);

	try {
		if (await isPrivateImageKeyRevoked(key)) return noStore(notFound('image_not_found'));
		const image = await downloadSupabaseImage(key);
		const headers = new Headers({
			'Cache-Control': 'private, no-store',
			'Content-Type': image.contentType,
			'X-Content-Type-Options': 'nosniff',
		});
		if (image.contentLength > 0) {
			headers.set('Content-Length', String(image.contentLength));
		}
		return new NextResponse(image.stream, { headers });
	} catch (error) {
		if (error instanceof ImageStorageObjectNotFoundError) {
			return noStore(notFound('image_not_found'));
		}
		if (error instanceof ImageStorageConfigurationError) {
			return noStore(
				NextResponse.json(
					{ error: 'feature_disabled', code: 'image_reads_unavailable' },
					{ status: 503 },
				),
			);
		}
		return noStore(serverError('image_read_failed'));
	}
}
