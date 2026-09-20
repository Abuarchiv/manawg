export const PRIVATE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const PRIVATE_IMAGE_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/heic',
	'image/heif',
] as const;

const PRIVATE_IMAGE_MIME_TYPE_SET = new Set<string>(PRIVATE_IMAGE_MIME_TYPES);

export function isAllowedPrivateImageMimeType(mimeType: string): boolean {
	return PRIVATE_IMAGE_MIME_TYPE_SET.has(mimeType);
}

export function isValidPrivateImageSize(fileSize: number): boolean {
	return Number.isInteger(fileSize) && fileSize > 0 && fileSize <= PRIVATE_IMAGE_MAX_BYTES;
}

export function hasExactPrivateImageBucketConfig(bucket: {
	public: boolean;
	file_size_limit?: number;
	allowed_mime_types?: string[];
}): boolean {
	const allowedMimeTypes = bucket.allowed_mime_types ?? [];
	return (
		bucket.public === false &&
		bucket.file_size_limit === PRIVATE_IMAGE_MAX_BYTES &&
		allowedMimeTypes.length === PRIVATE_IMAGE_MIME_TYPES.length &&
		PRIVATE_IMAGE_MIME_TYPES.every((mimeType) => allowedMimeTypes.includes(mimeType))
	);
}
