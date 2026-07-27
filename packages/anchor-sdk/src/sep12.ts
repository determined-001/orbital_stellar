import { z } from "zod";

export const Sep12CustomerInfoSchema = z.object({
  id: z.string().optional(),
  status: z.enum(["ACCEPTED", "PROCESSING", "NEEDS_INFO", "REJECTED"]),
  provided_fields: z
    .record(
      z.object({
        description: z.string().optional(),
        type: z.string().optional(),
        status: z.enum(["ACCEPTED", "PROCESSING", "NEEDS_INFO", "REJECTED"]).optional(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  fields: z
    .record(
      z.object({
        type: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  message: z.string().optional(),
});

export type Sep12CustomerInfo = z.infer<typeof Sep12CustomerInfoSchema>;

export class Sep12Client {
  constructor(private anchorUrl: string) {}

  async getCustomer(params: Record<string, string>, token: string): Promise<Sep12CustomerInfo> {
    const url = new URL(`${this.anchorUrl}/customer`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`SEP-12 GET /customer failed: ${response.statusText}`);
    }

    const data = await response.json();
    return Sep12CustomerInfoSchema.parse(data);
  }

  async putCustomer(data: FormData, token: string): Promise<{ id: string }> {
    const url = new URL(`${this.anchorUrl}/customer`);
    const response = await fetch(url.toString(), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: data,
    });

    if (!response.ok) {
      throw new Error(`SEP-12 PUT /customer failed: ${response.statusText}`);
    }

    return response.json();
  }
}
