import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRIVATE_IMAGE_MAX_BYTES, PRIVATE_IMAGE_MIME_TYPES } from './private-image-policy';

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;
const PUBLIC_URL = process.env.S3_PUBLIC_URL; // e.g. https://bucket.s3.region.amazonaws.com

const MAX_UPLOAD_BYTES = PRIVATE_IMAGE_MAX_BYTES;
const PRESIGN_TTL_SEC = 300;
const ALLOWED_MIME_TYPES = new Set<string>(PRIVATE_IMAGE_MIME_TYPES);

interface S3SignatureResponse {
	presignedUrl: string;
	publicUrl: string;
	maxFileSize: number;
}

function getClient(): S3Client {
	if (!REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
		throw new Error(
			'S3 credentials missing. Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.',
		);
	}
	return new S3Client({ region: REGION });
}

function getPublicBase(): string {
	if (PUBLIC_URL) return PUBLIC_URL.replace(/\/$/, '');
	if (!BUCKET || !REGION) throw new Error('S3_PUBLIC_URL or (S3_BUCKET + AWS_REGION) must be set.');
	return `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
}

export function isAllowedMimeType(mimeType: string): boolean {
	return ALLOWED_MIME_TYPES.has(mimeType);
}

function isSafeS3Key(key: string): boolean {
	return key.length > 0 && !key.startsWith('/') && !key.includes('..') && !key.includes('\\');
}

export async function createPresignedUpload(
	key: string,
	contentType: string,
	contentLength: number,
): Promise<S3SignatureResponse> {
	if (!isSafeS3Key(key)) throw new Error('Invalid S3 key');
	if (!BUCKET) throw new Error('S3_BUCKET env var missing.');
	if (!isAllowedMimeType(contentType)) throw new Error(`Disallowed content type: ${contentType}`);
	if (!Number.isInteger(contentLength) || contentLength <= 0) {
		throw new Error(`Invalid contentLength: ${contentLength}`);
	}
	if (contentLength > MAX_UPLOAD_BYTES) {
		throw new Error(`File too large: ${contentLength} > ${MAX_UPLOAD_BYTES}`);
	}

	const client = getClient();
	// Binding ContentLength into the signed PUT means S3 rejects any upload
	// whose Content-Length header doesn't match. Without this, the 8 MB cap
	// was advisory (client-side) and an attacker could PUT arbitrarily large
	// files — runaway storage + bandwidth bill.
	const command = new PutObjectCommand({
		Bucket: BUCKET,
		Key: key,
		ContentType: contentType,
		ContentLength: contentLength,
	});

	const presignedUrl = await getSignedUrl(client, command, {
		expiresIn: PRESIGN_TTL_SEC,
		// Both headers are bound into the signature so S3 rejects a PUT whose
		// Content-Length or Content-Type differs from what was validated here.
		unhoistableHeaders: new Set(['content-length', 'content-type']),
	});
	const publicUrl = `${getPublicBase()}/${key}`;

	return { presignedUrl, publicUrl, maxFileSize: MAX_UPLOAD_BYTES };
}

export const S3_MAX_UPLOAD_BYTES = PRIVATE_IMAGE_MAX_BYTES;
