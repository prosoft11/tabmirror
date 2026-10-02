import type { IncomingMessage } from 'node:http';
import { ApiError } from './private-store.js';
export async function body(
  req: IncomingMessage,
  limit: number,
): Promise<string> {
  if (
    req.headers['content-encoding'] ||
    req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
  )
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Uncompressed UTF-8 JSON required.',
    );
  if (Number(req.headers['content-length'] ?? 0) > limit)
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      'Request exceeds the size limit.',
    );
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit)
      throw new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Request exceeds the size limit.',
      );
    chunks.push(chunk);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Valid UTF-8 JSON required.');
  }
}
