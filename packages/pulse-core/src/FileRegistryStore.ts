import { promises as fsPromises } from "fs";
import path from "path";
import type { IRegistryStore } from "./IRegistryStore.js";
import type { Logger } from "./index.js";

type RegistryData = Record<string, string[]>;

export class FileRegistryStore implements IRegistryStore {
  private readonly filePath: string;
  private readonly logger?: Logger;
  private cache: RegistryData | null = null;

  constructor(filePath: string, logger?: Logger) {
    this.filePath = filePath;
    this.logger = logger;
  }

  private async load(): Promise<RegistryData> {
    if (this.cache !== null) return this.cache;
    try {
      const data = await fsPromises.readFile(this.filePath, "utf8");
      try {
        const parsed = JSON.parse(data);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          this.cache = parsed as RegistryData;
          return this.cache;
        }
        this.logger?.warn("FileRegistryStore: unexpected JSON shape, starting empty", {
          file: this.filePath,
        });
        this.cache = {};
        return this.cache;
      } catch {
        this.logger?.warn("FileRegistryStore: failed to parse registry file, starting empty", {
          file: this.filePath,
        });
        this.cache = {};
        return this.cache;
      }
    } catch (err: any) {
      if (err.code === "ENOENT") {
        this.cache = {};
        return this.cache;
      }
      throw err;
    }
  }

  private async persist(data: RegistryData): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });

    const tmp = `${this.filePath}.tmp-${Math.random().toString(36).slice(2)}`;
    const payload = JSON.stringify(data, null, 2);

    const fd = await fsPromises.open(tmp, "w");
    try {
      await fd.writeFile(payload, "utf8");
      await fd.sync();
    } finally {
      await fd.close();
    }

    await fsPromises.rename(tmp, this.filePath);

    // fsync directory to make rename durable (best-effort)
    try {
      const dirFd = await fsPromises.open(dir, "r");
      try {
        // @ts-expect-error - access internal fd
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

  async register(address: string, urls: string[]): Promise<void> {
    const data = await this.load();
    data[address] = [...urls];
    await this.persist(data);
  }

  async deregister(address: string): Promise<void> {
    const data = await this.load();
    delete data[address];
    await this.persist(data);
  }

  async get(address: string): Promise<string[]> {
    const data = await this.load();
    return [...(data[address] ?? [])];
  }

  async list(): Promise<Record<string, string[]>> {
    const data = await this.load();
    const result: Record<string, string[]> = {};
    for (const [address, urls] of Object.entries(data)) {
      result[address] = [...urls];
    }
    return result;
  }
}
