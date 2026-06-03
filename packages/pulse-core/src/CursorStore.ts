export interface CursorStore {
  get(streamKey: string): Promise<string | undefined>;
  set(streamKey: string, cursor: string): Promise<void>;
}