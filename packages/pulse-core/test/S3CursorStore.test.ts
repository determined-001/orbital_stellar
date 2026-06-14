import { describe, it, expect } from "vitest";
import { S3CursorStore, S3Like } from "../src/S3CursorStore.js";

function makeMockS3(): { s3: S3Like; _store: Map<string, string> } {
  const store = new Map<string, string>();
  const s3: S3Like = {
    async getObject({ Key }) {
      if (!store.has(Key)) {
        const e: any = new Error("NoSuchKey");
        e.code = "NoSuchKey";
        throw e;
      }
      return { Body: store.get(Key)! };
    },
    async putObject({ Key, Body }) {
      const text = typeof Body === "string" ? Body : Buffer.from(Body).toString();
      store.set(Key, text);
    },
  };
  return { s3, _store: store };
}

describe("S3CursorStore", () => {
  it("round-trips cursor values", async () => {
    const { s3 } = makeMockS3();
    const store = new S3CursorStore(s3, "my-bucket");

    expect(await store.getCursor("stream1")).toBeNull();

    await store.putCursor("stream1", "CURSOR_123");

    const got = await store.getCursor("stream1");
    expect(got).toBe("CURSOR_123");
  });

  it("treats NoSuchKey as null", async () => {
    const { s3 } = makeMockS3();
    const store = new S3CursorStore(s3, "b");

    // No objects present -> returns null
    await expect(store.getCursor("missing")).resolves.toBeNull();
  });

  it("throws for other S3 errors", async () => {
    const s3: S3Like = {
      async getObject() {
        const e: any = new Error("Bad");
        e.code = "SomeOtherError";
        throw e;
      },
      async putObject() {
        // noop
      },
    };

    const store = new S3CursorStore(s3, "b");
    await expect(store.getCursor("any")).rejects.toThrow("Bad");
  });
});
