import type { AnchorPaymentEvent, AnchorPaymentEventType } from "@orbital-stellar/pulse-core";
import { Sep12Client } from "../sep12/client.js";
import { Sep31Status, validateTransition, MissingFieldsError } from "./status.js";

export interface Sep31ClientOptions {
  anchorUrl: string;
}

export interface InitiatePaymentParams {
  assetCode: string;
  amount: string;
  senderId?: string;
  receiverId?: string;
  fields?: Record<string, string>;
  jwt: string;
}

export class Sep31Client {
  public readonly sep12: Sep12Client;

  constructor(private readonly options: Sep31ClientOptions) {
    this.sep12 = new Sep12Client({ anchorUrl: options.anchorUrl });
  }

  async getInfo(): Promise<any> {
    const response = await fetch(`${this.options.anchorUrl}/info`);
    if (!response.ok) {
      throw new Error(`SEP-31 GET /info failed: ${response.status}`);
    }
    return response.json();
  }

  async initiatePayment(params: InitiatePaymentParams): Promise<any> {
    const body: Record<string, any> = {
      asset_code: params.assetCode,
      amount: params.amount,
      sender_id: params.senderId,
      receiver_id: params.receiverId,
      fields: params.fields,
    };

    const response = await fetch(`${this.options.anchorUrl}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.jwt}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 400) {
      const data = await response.json();
      if (data.error === "customer_info_needed" || data.error === "transaction_info_needed") {
        throw new MissingFieldsError(data.fields ?? {});
      }
      throw new Error(`SEP-31 transaction initiation failed: ${JSON.stringify(data)}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SEP-31 POST /transactions failed: ${response.status} ${text}`);
    }

    return response.json();
  }

  async getTransaction(id: string, jwt: string): Promise<any> {
    const response = await fetch(
      `${this.options.anchorUrl}/transactions/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SEP-31 GET /transactions/:id failed: ${response.status} ${text}`);
    }

    return response.json();
  }

  /**
   * Normalizes a raw SEP-31 transaction response into the pulse-core taxonomy AnchorPaymentEvent.
   */
  normalizeEvent(rawTx: any): AnchorPaymentEvent {
    const timestampStr = rawTx.started_at || new Date().toISOString();

    // Validate the status internally (though in normalization it's a read-only mapping,
    // we assume the anchor provided a valid status)
    const protocolStatus = (rawTx.status || "error") as Sep31Status;

    return {
      type: "anchor.payment" as AnchorPaymentEventType,
      payment_id: rawTx.id,
      source: rawTx.stellar_account_id || rawTx.stellar_memo || "",
      destination: rawTx.stellar_account_id || "",
      amount: rawTx.amount_in || "",
      asset: rawTx.amount_in_asset || "",
      timestamp: timestampStr,
      get timestampDate() {
        return new Date(timestampStr);
      },
      protocol_status: {
        protocol: "sep31",
        status: protocolStatus,
      },
    };
  }
}
