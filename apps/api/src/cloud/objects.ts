import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { MAX_SNAPSHOT_BYTES } from '@tabmirror/contracts';
export interface Objects {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
export class S3Objects implements Objects {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  async put(key: string, value: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: value,
        ContentType: 'application/json',
        CacheControl: 'no-store',
        ServerSideEncryption: 'AES256',
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
  }
  async get(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    if (!result.Body) throw new Error('Snapshot unavailable');
    if ((result.ContentLength ?? Infinity) > MAX_SNAPSHOT_BYTES) {
      (result.Body as any).destroy?.();
      throw new Error('Snapshot exceeds storage limit');
    }
    const bytes = await result.Body.transformToByteArray();
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES)
      throw new Error('Snapshot exceeds storage limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
  }
}
