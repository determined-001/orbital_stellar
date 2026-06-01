import { promises as fsPromises, constants as fsConstants } from "fs";
import fs from "fs";
import path from "path";
import { CursorStore } from "./CursorStore.js";

function safeFilename(streamKey: string): string {
  return encodeURIComponent(streamKey) + ".json";
}

export class FileCursorStore implements CursorStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private filePathFor(streamKey: string): string {
    return path.join(this.dir, safeFilename(streamKey));
  }

  private async ensureDir(): Promise<void> {
    await fsPromises.mkdir(this.dir, { recursive: true });
  }

  async get(streamKey: string): Promise<string | null> {
    const file = this.filePathFor(streamKey);
    try {
      const data = await fsPromises.readFile(file, "utf8");
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed.cursor === "string") return parsed.cursor;
        return null;
      } catch (err) {
        console.warn(
          `FileCursorStore: failed to parse cursor file ${file}, treating as missing`,
        );
        return null;
      }
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    await this.ensureDir();
    const file = this.filePathFor(streamKey);
    const tmp = `${file}.tmp-${Math.random().toString(36).slice(2)}`;
    const payload = JSON.stringify({
      cursor,
      updated_at: new Date().toISOString(),
    });

    // Write to tmp file, fsync, rename, fsync directory
    const fd = await fsPromises.open(tmp, "w");
    try {
      await fd.writeFile(payload, "utf8");
      await fd.sync();
    } finally {
      await fd.close();
    }

    // Rename tmp -> final
    await fsPromises.rename(tmp, file);

    // fsync directory to ensure rename durable (best-effort)
    try {
      const dirFd = await fsPromises.open(this.dir, "r");
      try {
        // Node's fsPromises doesn't expose fsync on DirHandle, so use fs.fsync with numeric fd
        // @ts-ignore - access internal fd
        await fsPromises.fsync((dirFd as any).fd);
      } catch (_) {
        // ignore
      } finally {
        await dirFd.close();
      }
    } catch (_) {
      // ignore
    }
  }
}

export default FileCursorStore;
