import type { NormalizedEvent } from "@orbital/pulse-core";

export type DlqEntry = {
  id: string;
  address: string;
  url: string;
  attempts: number;
  last_error: string;
  payload: NormalizedEvent;
  created_at: string;
  replayed_at: string | null;
};

/** Minimal pg-compatible client interface — avoids a hard dep on `pg`. */
export interface PgClient {
  query<R = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: R[] }>;
}
