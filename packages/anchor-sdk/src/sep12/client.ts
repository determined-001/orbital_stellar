import { Horizon } from "@stellar/stellar-sdk";

export type CustomerInfo = Record<string, string | number | boolean>;

export interface Sep12ClientOptions {
  anchorUrl: string;
}

export class Sep12Client {
  constructor(private readonly options: Sep12ClientOptions) {}

  /**
   * Puts customer info to the anchor's SEP-12 endpoint.
   */
  async putCustomerInfo(info: CustomerInfo, jwt: string): Promise<string> {
    const response = await fetch(`${this.options.anchorUrl}/customer`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(info),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SEP-12 PUT /customer failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Gets customer info from the anchor's SEP-12 endpoint.
   */
  async getCustomerInfo(id: string, jwt: string): Promise<any> {
    const response = await fetch(
      `${this.options.anchorUrl}/customer?id=${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SEP-12 GET /customer failed: ${response.status} ${text}`);
    }

    return response.json();
  }
}
