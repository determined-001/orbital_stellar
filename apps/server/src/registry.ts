import { createHmac } from "crypto";
import { EventEngine } from "@orbital/pulse-core";
import { WebhookDelivery } from "@orbital/pulse-webhooks";
import { config } from "./config.js";

// --- Types ---

export type WebhookRegistration = {
  address: string;
  url: string;
  /** HMAC-SHA256 hash of the original secret — never the plaintext */
  secretHash: string;
  createdAt: string;
  /** Retained to keep retry timers alive and enable cleanup */
  delivery: WebhookDelivery;
};

/** Shape returned to callers — secret fields are omitted */
export type WebhookRegistrationPublic = Omit<WebhookRegistration, "secretHash" | "delivery">;

// --- Helpers ---

function hashSecret(secret: string): string {
  // Use a fixed HMAC key from config so the hash is deterministic for signature
  // verification, but not reversible without the key.
  const hmacKey = config.WEBHOOK_SECRET;
  return createHmac("sha256", hmacKey).update(secret).digest("hex");
}

// --- Registry ---

export class WebhookRegistry {
  private registrations: Map<string, WebhookRegistration> = new Map();
  private engine: EventEngine;

  constructor(engine: EventEngine) {
    this.engine = engine;
  }

  register(address: string, url: string, secret: string): WebhookRegistrationPublic {
    // Guard: return existing without re-subscribing or re-attaching listeners
    if (this.registrations.has(address)) {
      return this.toPublic(this.registrations.get(address)!);
    }

    const secretHash = hashSecret(secret);

    // Subscribe to pulse-core — engine deduplicates by address
    const watcher = this.engine.subscribe(address);

    // Store the delivery instance so its retry timers are not GC'd
    const delivery = new WebhookDelivery(watcher, { url, secret });

    // Use watcher.once so this listener cannot accumulate on re-register
    watcher.once("webhook.failed", (event) => {
      console.error(`[registry] Webhook delivery failed for ${address}:`, event.raw);
    });

    const registration: WebhookRegistration = {
      address,
      url,
      secretHash,
      createdAt: new Date().toISOString(),
      delivery,
    };

    this.registrations.set(address, registration);
    console.log(`[registry] Registered ${address} → ${url}`);
    return this.toPublic(registration);
  }

  unregister(address: string): boolean {
    if (!this.registrations.has(address)) return false;

    // Stopping the watcher clears its retry timers via addStopHandler in WebhookDelivery
    this.engine.unsubscribe(address);
    this.registrations.delete(address);
    console.log(`[registry] Unregistered ${address}`);
    return true;
  }

  list(): WebhookRegistrationPublic[] {
    return Array.from(this.registrations.values()).map(this.toPublic);
  }

  has(address: string): boolean {
    return this.registrations.has(address);
  }

  /** Returns the stored secret hash for a given address (used for HMAC verification) */
  getSecretHash(address: string): string | undefined {
    return this.registrations.get(address)?.secretHash;
  }

  private toPublic(reg: WebhookRegistration): WebhookRegistrationPublic {
    return { address: reg.address, url: reg.url, createdAt: reg.createdAt };
  }
}
