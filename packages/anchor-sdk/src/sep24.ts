import { z } from "zod";
import type { Sep24Status } from "@orbital-stellar/pulse-core";

/**
 * SEP-24 interactive deposit and withdrawal.
 *
 * The client covers `/info`, interactive initiation and transaction polling.
 * Status handling lives in {@link Sep24StatusMachine} so an illegal transition
 * is an error rather than a silent overwrite.
 */

/** Thrown when a SEP-24 request fails or returns an unusable body. */
export class Sep24Error extends Error {
  constructor(reason: string) {
    super(`[anchor-sdk] SEP-24 request failed: ${reason}`);
    this.name = "Sep24Error";
  }
}

/** Thrown when the anchor needs more customer information before proceeding. */
export class Sep24CustomerInfoNeededError extends Error {
  constructor(public readonly fields: string[]) {
    super(`[anchor-sdk] SEP-24 customer info needed: ${fields.join(", ")}`);
    this.name = "Sep24CustomerInfoNeededError";
  }
}

const AssetOperationSchema = z.object({
  enabled: z.boolean(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  fee_fixed: z.number().optional(),
  fee_percent: z.number().optional(),
});

export const Sep24InfoSchema = z.object({
  deposit: z.record(z.string(), AssetOperationSchema).optional(),
  withdraw: z.record(z.string(), AssetOperationSchema).optional(),
  fee: z.object({ enabled: z.boolean() }).optional(),
});

export type Sep24Info = z.infer<typeof Sep24InfoSchema>;

export const Sep24InteractiveResponseSchema = z.object({
  /** Always "interactive_customer_info_needed" per SEP-24. */
  type: z.string(),
  /** URL to open in a webview so the user can complete the flow. */
  url: z.string(),
  /** The anchor's transaction id, to poll with. */
  id: z.string(),
});

export type Sep24InteractiveResponse = z.infer<typeof Sep24InteractiveResponseSchema>;

const SEP24_STATUSES = [
  "incomplete",
  "pending_user_transfer_start",
  "pending_user_transfer_complete",
  "pending_external",
  "pending_anchor",
  "pending_stellar",
  "pending_trust",
  "pending_user",
  "completed",
  "refunded",
  "expired",
  "no_market",
  "too_small",
  "too_large",
  "error",
] as const satisfies readonly Sep24Status[];

export const Sep24TransactionSchema = z.object({
  id: z.string(),
  kind: z.enum(["deposit", "withdrawal"]),
  status: z.enum(SEP24_STATUSES),
  status_eta: z.number().optional(),
  amount_in: z.string().optional(),
  amount_out: z.string().optional(),
  amount_fee: z.string().optional(),
  started_at: z.string().optional(),
  updated_at: z.string().optional(),
  completed_at: z.string().optional(),
  /** Hash of the Stellar transaction that settled this flow, when published. */
  stellar_transaction_id: z.string().optional(),
  external_transaction_id: z.string().optional(),
  message: z.string().optional(),
  refunded: z.boolean().optional(),
});

export type Sep24Transaction = z.infer<typeof Sep24TransactionSchema>;

export type Sep24ClientOptions = {
  transport?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

export type Sep24InitiateParams = {
  asset_code: string;
  asset_issuer?: string;
  account?: string;
  amount?: string;
  lang?: string;
  /** Extra SEP-9 fields the anchor asks for. */
  fields?: Record<string, string>;
};

export class Sep24Client {
  private readonly transferServer: string;
  private readonly transport: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;

  constructor(transferServer: string, options: Sep24ClientOptions = {}) {
    this.transferServer = transferServer.replace(/\/+$/, "");
    this.transport = options.transport ?? fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** GET /info - which assets the anchor supports and their limits. */
  async info(): Promise<Sep24Info> {
    const response = await this.request(`${this.transferServer}/info`, { method: "GET" });
    if (!response.ok) {
      throw new Sep24Error(`GET /info returned ${response.status}`);
    }
    return this.parse(Sep24InfoSchema, await response.json(), "/info");
  }

  /** POST /transactions/deposit/interactive. */
  async initiateDeposit(
    params: Sep24InitiateParams,
    token: string,
  ): Promise<Sep24InteractiveResponse> {
    return this.initiate("deposit", params, token);
  }

  /** POST /transactions/withdraw/interactive. */
  async initiateWithdrawal(
    params: Sep24InitiateParams,
    token: string,
  ): Promise<Sep24InteractiveResponse> {
    return this.initiate("withdraw", params, token);
  }

  /** GET /transaction?id= - a single transaction's current state. */
  async transaction(id: string, token: string): Promise<Sep24Transaction> {
    const url = new URL(`${this.transferServer}/transaction`);
    url.searchParams.set("id", id);

    const response = await this.request(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Sep24Error(`GET /transaction returned ${response.status}`);
    }

    const envelope = body as { transaction?: unknown };
    return this.parse(Sep24TransactionSchema, envelope.transaction ?? body, "/transaction");
  }

  private async initiate(
    kind: "deposit" | "withdraw",
    params: Sep24InitiateParams,
    token: string,
  ): Promise<Sep24InteractiveResponse> {
    const { fields, ...rest } = params;
    const response = await this.request(`${this.transferServer}/transactions/${kind}/interactive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...rest, ...fields }),
    });

    const body: unknown = await response.json().catch(() => ({}));

    if (!response.ok) {
      const record = (body ?? {}) as { type?: string; fields?: unknown; error?: unknown };
      if (
        record.type === "customer_info_status" ||
        record.type === "non_interactive_customer_info_needed"
      ) {
        const fieldNames = Array.isArray(record.fields)
          ? record.fields.map(String)
          : Object.keys((record.fields as Record<string, unknown> | undefined) ?? {});
        throw new Sep24CustomerInfoNeededError(fieldNames);
      }
      throw new Sep24Error(
        `POST /transactions/${kind}/interactive returned ${response.status}${
          record.error ? `: ${String(record.error)}` : ""
        }`,
      );
    }

    return this.parse(Sep24InteractiveResponseSchema, body, `/transactions/${kind}/interactive`);
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown, endpoint: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Sep24Error(`${endpoint} returned an unexpected body: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.transport(url, { ...init, signal: controller.signal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Sep24Error(`request to ${url} failed (${reason})`);
    } finally {
      clearTimeout(timer);
    }
  }
}
