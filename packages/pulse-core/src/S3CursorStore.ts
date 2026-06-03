export type S3Like = {
  getObject(params: {
    Bucket: string;
    Key: string;
  }): Promise<{ Body: string | Uint8Array }>;
  putObject(params: {
    Bucket: string;
    Key: string;
    Body: string | Uint8Array;
  }): Promise<void>;
};

export class S3CursorStore {
  private readonly s3: S3Like;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(s3: S3Like, bucket: string, prefix = "cursors/") {
    this.s3 = s3;
    this.bucket = bucket;
    this.prefix = prefix;
  }

  private keyFor(streamKey: string): string {
    return `${this.prefix}${streamKey}.json`;
  }

  async getCursor(streamKey: string): Promise<string | null> {
    const Key = this.keyFor(streamKey);
    try {
      const res = await this.s3.getObject({ Bucket: this.bucket, Key });
      const body = res.Body;
      const text =
        typeof body === "string" ? body : Buffer.from(body).toString();
      try {
        const parsed = JSON.parse(text as string);
        if (parsed && typeof parsed.cursor === "string") return parsed.cursor;
        return null;
      } catch (err) {
        // If the object isn't JSON, treat as null / invalid
        return null;
      }
    } catch (err: any) {
      // Treat NoSuchKey as missing value
      if (
        err &&
        (err.code === "NoSuchKey" ||
          err.name === "NoSuchKey" ||
          err.code === "NoSuchKeyException")
      ) {
        return null;
      }
      throw err;
    }
  }

  async putCursor(streamKey: string, cursor: string): Promise<void> {
    const Key = this.keyFor(streamKey);
    const Body = JSON.stringify({ cursor });
    await this.s3.putObject({ Bucket: this.bucket, Key, Body });
  }
}

export default S3CursorStore;
