import { z } from "zod";
import type { Sep31Status } from "@orbital-stellar/pulse-core";
import { Sep12Client, Sep12CustomerInfo } from "./sep12.js";

export const Sep31InfoSchema = z.object({
  receive: z.record(
    z.object({
      quotes_supported: z.boolean().optional(),
      quotes_required: z.boolean().optional(),
      fee_fixed: z.number().optional(),
      fee_percent: z.number().optional(),
      min_amount: z.number().optional(),
      max_amount: z.number().optional(),
      sender_sep12_type: z.string().optional(),
      receiver_sep12_type: z.string().optional(),
      fields: z
        .object({
          transaction: z
            .record(
              z.object({
                description: z.string(),
                choices: z.array(z.string()).optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    }),
  ),
});

export type Sep31Info = z.infer<typeof Sep31InfoSchema>;

export class MissingFieldsError extends Error {
  constructor(public missingFields: string[]) {
    super(`Missing required fields: ${missingFields.join(", ")}`);
    this.name = "MissingFieldsError";
  }
}

export class CustomerInfoNeededError extends Error {
  constructor(
    public customerType: "sender" | "receiver",
    public neededFields: string[],
  ) {
    super(`Customer info needed for ${customerType}: ${neededFields.join(", ")}`);
    this.name = "CustomerInfoNeededError";
  }
}

export class Sep31Client {
  public sep12: Sep12Client;

  constructor(private anchorUrl: string) {
    this.sep12 = new Sep12Client(anchorUrl);
  }

  async info(): Promise<Sep31Info> {
    const url = new URL(`${this.anchorUrl}/info`);
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`SEP-31 GET /info failed: ${response.statusText}`);
    }
    const data = await response.json();
    return Sep31InfoSchema.parse(data);
  }

  async initiateTransaction(
    params: {
      asset_code: string;
      sender_id?: string;
      receiver_id?: string;
      fields?: Record<string, string>;
    },
    token: string,
  ): Promise<{
    id: string;
    stellar_account_id: string;
    stellar_memo: string;
    stellar_memo_type: string;
  }> {
    const response = await fetch(`${this.anchorUrl}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 400 && data.error === "transaction_info_needed") {
        throw new MissingFieldsError(data.fields || []);
      }
      if (response.status === 400 && data.error === "customer_info_needed") {
        // Technically customer_info_needed returns type of customer
        throw new CustomerInfoNeededError(data.type || "sender", data.fields || []);
      }
      throw new Error(`SEP-31 POST /transactions failed: ${data.error || response.statusText}`);
    }

    return data;
  }

  async pollStatus(
    transactionId: string,
    token: string,
  ): Promise<{
    id: string;
    status: Sep31Status;
    status_eta?: number;
    amount_in?: string;
    amount_out?: string;
    message?: string;
  }> {
    const response = await fetch(`${this.anchorUrl}/transactions/${transactionId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`SEP-31 GET /transactions/:id failed: ${data.error || response.statusText}`);
    }

    return data.transaction;
  }
}
