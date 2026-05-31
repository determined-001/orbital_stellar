export interface PublishResult {
  contractId: string;
  version: string;
  etag: string;
}

export interface RegistryPublisher {
  publish(spec: unknown): Promise<PublishResult>;
}

export class LocalFilePublisher implements RegistryPublisher {
  async publish(spec: unknown): Promise<PublishResult> {
    const contractId =
      typeof spec === "object" &&
      spec !== null &&
      "contractId" in spec
        ? String((spec as Record<string, unknown>).contractId)
        : "unknown";

    return {
      contractId,
      version: "local",
      etag: `local-${Date.now()}`,
    };
  }
}