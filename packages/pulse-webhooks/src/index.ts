import type {
  DecodeFailedNotification,
  NormalizedEvent,
  Watcher,
  WatcherNotification,
} from "@orbital-stellar/pulse-core";

import { createHmac, timingSafeEqual, randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { BlockList, isIP } from "net";

import { DeadLetterStore } from "./MemoryDeadLetterStore.js";
import { exponentialJittered } from "./backoff.js";
import type { BackoffStrategy } from "./backoff.js";
import type { RetryQueue, RetryRecord } from "./RetryQueue.js";
import type { Tracer, VerifyWebhookOptions, WebhookConfig } from "./types.js";
import { DEFAULT_MAX_AGE_MS, DEFAULT_CLOCK_SKEW_MS } from "./types.js";

const BLOCKED_WEBHOOK_ADDRESSES = new BlockList();
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED_WEBHOOK_ADDRESSES.addAddress("::1", "ipv6");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("fc00::", 7, "ipv6");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("fe80::", 10, "ipv6");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("::ffff:a00:0", 104, "ipv6");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("::ffff:7f00:0", 104, "ipv6");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("::ffff:ac10:0", 108, "ipv6");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("::ffff:c0a8:0", 112, "ipv6");
BLOCKED_WEBHOOK_ADDRESSES.addSubnet("::ffff:a9fe:0", 112, "ipv6");

const BLOCKED_ADDRESS_ERROR = "Webhook URL points to a blocked private address";
export { DeadLetterStore } from "./MemoryDeadLetterStore.js";
export { NOOP_WEBHOOK_METRICS, CountingWebhookMetrics } from "./metrics.js";
export type { WebhookAttemptStatus, WebhookMetrics, WebhookTerminalOutcome } from "./types.js";
export { exponentialJittered, linear, cappedExponential, constant } from "./backoff.js";
export type { BackoffStrategy } from "./backoff.js";
export { PostgresDeadLetterStore } from "./PostgresDeadLetterStore.js";
export { RedisRetryQueue } from "./RedisRetryQueue.js";
export { MemoryRetryQueue } from "./MemoryRetryQueue.js";
export { SqsRetryQueue } from "./SqsRetryQueue.js";
export { verifyWebhookEdge, verifyWebhookEdgeRaw } from "./edge.js";
export { dedupReceiver, MemoryDedupStore } from "./dedup.js";
export type { DedupStore, DedupReceiverOptions } from "./dedup.js";
export type {
  DeadLetterEntry,
  DeadLetterFilter as MemoryDeadLetterFilter,
  DeliveryHealth,
} from "./MemoryDeadLetterStore.js";
export type {
  DeadLetterFilter,
  DeadLetterInput,
  DeadLetterRecord,
  PgLike,
} from "./PostgresDeadLetterStore.js";
export type { RedisLike, RedisRetryQueueOptions } from "./RedisRetryQueue.js";
export type { MemoryRetryQueueOptions } from "./MemoryRetryQueue.js";
export type {
  SqsLike,
  SqsRetryQueueOptions,
  SendMessageInput,
  SendMessageOutput,
  ReceiveMessageInput,
  ReceiveMessageOutput,
  DeleteMessageInput,
  DeleteMessageOutput,
  SqsMessage,
} from "./SqsRetryQueue.js";
export type { RetryQueue, RetryRecord } from "./RetryQueue.js";
export type {
  Span,
  Tracer,
  VerifierSignatureVersion,
  VerifyWebhookOptions,
  WebhookConfig,
} from "./types.js";

/**
 * Payload for the `raw` field of a `webhook.failed` event.
 */
export type WebhookFailureRaw = {
  /** Summary of the error that caused delivery to fail. */
  error: string;
  /** The target URL that failed delivery. */
  url: string;
  /** Total number of attempts made before giving up. */
  attempts: number;
  /** The original event that we tried to deliver. */
  originalEvent: NormalizedEvent;
  /** ID of the dead-letter store entry recorded for this terminal failure. */
  dlqId: string;
};

/**
 * Payload for the `raw` field of a `webhook.dropped` event.
 */
export type WebhookDroppedRaw = {
  /** The reason the webhook was dropped. Currently only `retry_cap_exceeded`. */
  reason: "retry_cap_exceeded";
  /** The target URL that was dropped. */
  url: string;
  /** The `maxConcurrentRetries` limit that was hit. */
  maxConcurrentRetries: number;
  /** The original event that was dropped. */
  originalEvent: NormalizedEvent;
};

/**
 * Payload for the `raw` field of a `webhook.backpressure` event.
 */
export type WebhookBackpressureRaw = {
  /** The reason backpressure was triggered. */
  reason: "concurrent_delivery_cap_exceeded";
  /** The target URL that was queued. */
  url: string;
  /** The `maxConcurrentDeliveries` limit that was hit. */
  maxConcurrentDeliveries: number;
  /** Number of events currently queued due to backpressure. */
  pendingCount: number;
  /** The original event that triggered backpressure. */
  originalEvent: NormalizedEvent;
};

type ResolvedWebhookConfig = Omit<
  Required<WebhookConfig>,
  "url" | "tracer" | "urlValidator" | "metrics" | "backoff" | "retryQueue"
> & {
  urls: string[];
  backoff: BackoffStrategy;
  tracer?: Tracer;
  urlValidator?: WebhookConfig["urlValidator"];
  metrics?: WebhookConfig["metrics"];
  retryQueue?: RetryQueue;
};

export class WebhookDelivery {
  private config: ResolvedWebhookConfig;
  private watcher: Watcher;
  private dlq: DeadLetterStore;
  // Map of timer -> event so we can evict the newest entry when the cap is hit.
  private retryTimers: Map<ReturnType<typeof setTimeout>, { event: NormalizedEvent; url: string }> =
    new Map();
  private retryQueue?: RetryQueue;
  private pollerTimer?: ReturnType<typeof setInterval>;
  // Map to store idempotency delivery IDs per event and URL
  private deliveryIds: Map<NormalizedEvent, Map<string, string>> = new Map();

  // Timers that fire a durable-queue drain at each record's due time (only used
  // when `config.retryQueue` is set).
  private queueDrainTimers = new Set<ReturnType<typeof setTimeout>>();

  // Monotonic counter for durable RetryRecord ids.
  private retrySeq = 0;

  // Track active in-flight deliveries for the concurrent delivery cap.
  private activeDeliveries = 0;
  // Overflow queue for deliveries that exceed the concurrent delivery cap.
  private overflowQueue: Array<{ event: NormalizedEvent; url: string }> = [];
  constructor(watcher: Watcher, config: WebhookConfig, dlq?: DeadLetterStore) {
    this.watcher = watcher;
    this.dlq = dlq ?? new DeadLetterStore();
    this.config = {
      retries: 3,
      deliveryTimeoutMs: 10000,
      maxConcurrentRetries: 100,
      maxConcurrentDeliveries: 100,
      random: Math.random,
      backoff: exponentialJittered,
      retryQueuePollIntervalMs: 1000,
      ...config,
      tracer: config.tracer,
      urls: Array.isArray(config.url) ? [...config.url] : [config.url],
    };
    this.config.maxConcurrentRetries = Math.max(1, this.config.maxConcurrentRetries);
    this.config.maxConcurrentDeliveries = Math.max(1, this.config.maxConcurrentDeliveries);
    this.retryQueue = config.retryQueue;

    this.watcher.addStopHandler(() => {
      this.clearRetryTimers();
      this.stopPoller();
    });

    if (this.retryQueue) {
      this.startPoller();
    }

    this.watcher.on(
      "*",
      (event: NormalizedEvent | WatcherNotification | DecodeFailedNotification) => {
        if ("raw" in event) {
          for (const url of this.config.urls) {
            this.dispatchDelivery(event, url);
          }
        }
      },
    );
  }

  getDeadLetterStore(): DeadLetterStore {
    return this.dlq;
  }

  private async doAttempt(
    event: NormalizedEvent,
    url: string,
    attempt: number,
  ): Promise<{ ok: true } | { ok: false; error: string; terminal?: boolean }> {
    if (this.watcher.stopped) return { ok: false, error: "stopped", terminal: true };

    const builtInValidationError = this.validateUrl(url);
    if (builtInValidationError) {
      this.emitFailure(event, url, builtInValidationError, attempt);
      return { ok: false, error: builtInValidationError, terminal: true };
    }

    let customValidationError: string | null = null;
    try {
      customValidationError = this.config.urlValidator ? await this.config.urlValidator(url) : null;
    } catch (err) {
      if (this.watcher.stopped) return { ok: false, error: "stopped", terminal: true };
      return { ok: false, error: this.getErrorMessage(err), terminal: true };
    }

    if (this.watcher.stopped) return { ok: false, error: "stopped", terminal: true };

    if (customValidationError) {
      return { ok: false, error: customValidationError, terminal: true };
    }

    const resolvedHostnameError = await this.validateResolvedHostname(url);
    if (this.watcher.stopped) return { ok: false, error: "stopped", terminal: true };

    if (resolvedHostnameError) {
      this.emitFailure(event, url, resolvedHostnameError, attempt);
      return { ok: false, error: resolvedHostnameError, terminal: true };
    }

    const payload = JSON.stringify(event);
    const timestamp = Date.now().toString();
    const signature = this.sign(payload, timestamp);
    const controller = new AbortController();
    const timeoutMs = this.config.deliveryTimeoutMs;
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);

    // Idempotency header: generate or reuse UUID per event-URL pair
    let urlDeliveryMap = this.deliveryIds.get(event);
    if (!urlDeliveryMap) {
      urlDeliveryMap = new Map();
      this.deliveryIds.set(event, urlDeliveryMap);
    }
    let deliveryId = urlDeliveryMap.get(url);
    if (!deliveryId) {
      // Use crypto.randomUUID for UUID v4
      deliveryId = randomUUID();
      urlDeliveryMap.set(url, deliveryId);
    }

    const parentTraceId = this.extractTraceId(event);
    const spanAttrs: Record<string, string | number | boolean> = {
      "webhook.url": url,
      "webhook.attempt": attempt,
      url: url,
      attempt: attempt,
    };
    if (parentTraceId !== undefined) {
      spanAttrs["webhook.parent_trace_id"] = parentTraceId;
      spanAttrs["parent_trace_id"] = parentTraceId;
    }
    const span = this.config.tracer?.startSpan("webhook.delivery", spanAttrs);
    const startMs = Date.now();

    try {
      const res = await fetch(url, {
        method: "POST",
        // Redirect targets have not passed the URL and DNS checks above.
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "x-orbital-signature": signature,
          "x-orbital-timestamp": timestamp,
          "x-orbital-attempt": String(attempt),
          "x-orbital-delivery-id": deliveryId,
        },
        body: payload,
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const successMs = Date.now() - startMs;
      span?.setAttribute("webhook.status", res.status);
      span?.setAttribute("status", res.status);
      span?.setAttribute("webhook.latency_ms", successMs);
      span?.setAttribute("latency", successMs);
      this.config.metrics?.recordAttempt(url, attempt, successMs, "success");
      this.config.metrics?.recordTerminal(url, "success");
      this.dlq.recordSuccess(url);
      return { ok: true };
    } catch (err) {
      const failureMs = Date.now() - startMs;
      span?.setAttribute("webhook.latency_ms", failureMs);
      span?.setAttribute("latency", failureMs);
      span?.setAttribute("webhook.error", this.getErrorMessage(err));
      span?.setAttribute("error", this.getErrorMessage(err));

      if (this.watcher.stopped) return { ok: false, error: "stopped" };

      const errorMessage = this.getErrorMessage(err);
      this.config.metrics?.recordAttempt(url, attempt, failureMs, "failure");
      this.dlq.recordFailure(url);
      return { ok: false, error: errorMessage };
    } finally {
      clearTimeout(abortTimer);
      span?.end();
    }
  }

  private async deliverToUrl(event: NormalizedEvent, url: string, attempt = 1): Promise<void> {
    const result = await this.doAttempt(event, url, attempt);
    if (result.ok) return;
    if (this.watcher.stopped) return;

    const errorMessage = result.error;

    if (!result.terminal && attempt < this.config.retries) {
      if (this.config.retryQueue) {
        await this.persistRetry(this.config.retryQueue, event, url, attempt + 1, errorMessage);
      } else {
        if (this.retryTimers.size >= this.config.maxConcurrentRetries) {
          const newestTimer = [...this.retryTimers.keys()].at(-1)!;
          const newest = this.retryTimers.get(newestTimer)!;
          clearTimeout(newestTimer);
          this.retryTimers.delete(newestTimer);
          this.emitDropped(newest.event, newest.url);
        }

        const delay = this.config.backoff(attempt, this.config.random);
        const retryTimer = setTimeout(() => {
          this.retryTimers.delete(retryTimer);
          void this.deliverToUrl(event, url, attempt + 1);
        }, delay);
        this.retryTimers.set(retryTimer, { event, url });
      }
    } else {
      this.emitFailure(event, url, errorMessage, attempt);
    }
  }

  private startPoller(): void {
    const intervalMs = this.config.retryQueuePollIntervalMs;
    this.pollerTimer = setInterval(() => {
      this.retryQueue!.dequeue().then((record) => {
        if (record) {
          void this.processQueueRecord(record);
        }
      });
    }, intervalMs);
  }

  private stopPoller(): void {
    if (this.pollerTimer !== undefined) {
      clearInterval(this.pollerTimer);
      this.pollerTimer = undefined;
    }
  }

  private async processQueueRecord(record: RetryRecord): Promise<void> {
    if (this.watcher.stopped) return;

    const result = await this.doAttempt(
      record.event as NormalizedEvent,
      record.url,
      record.attempt,
    );
    if (this.watcher.stopped) return;

    if (result.ok) {
      await this.retryQueue!.ack(record.id);
    } else if (!result.terminal && record.attempt < this.config.retries) {
      const delay = this.config.backoff(record.attempt, this.config.random);
      await this.retryQueue!.nack(record.id, delay);
    } else {
      await this.retryQueue!.ack(record.id);
      this.emitFailure(record.event as NormalizedEvent, record.url, result.error, record.attempt);
    }
  }

  private validateUrl(url: string): string | null {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return "Invalid webhook URL";
    }

    const hostname = this.normalizeHostname(parsedUrl.hostname);
    if (hostname === "localhost") {
      return BLOCKED_ADDRESS_ERROR;
    }

    if (this.isBlockedIp(hostname)) {
      return BLOCKED_ADDRESS_ERROR;
    }

    return null;
  }

  private normalizeHostname(hostname: string): string {
    return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  }

  private isBlockedIp(address: string): boolean {
    const ipVersion = isIP(address);
    if (ipVersion === 4) {
      return BLOCKED_WEBHOOK_ADDRESSES.check(address, "ipv4");
    }
    if (ipVersion === 6) {
      // URL normalisation converts mapped dotted forms such as
      // ::ffff:10.0.0.1 to their canonical hexadecimal form ::ffff:a00:1.
      return BLOCKED_WEBHOOK_ADDRESSES.check(address, "ipv6");
    }

    return false;
  }

  private async validateResolvedHostname(url: string): Promise<string | null> {
    const hostname = this.normalizeHostname(new URL(url).hostname);
    if (isIP(hostname) !== 0) return null;

    try {
      // Check every A and AAAA answer before each attempt. This prevents a
      // public answer from masking a private IPv6 answer and re-checks retries.
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      if (addresses.length === 0) {
        return "Webhook hostname did not resolve to an IP address";
      }

      return addresses.some(({ address }) => this.isBlockedIp(address))
        ? BLOCKED_ADDRESS_ERROR
        : null;
    } catch {
      // DNS failures must fail closed; delivery can retry and resolve again.
      return "Webhook hostname could not be resolved";
    }
  }

  private extractTraceId(event: NormalizedEvent): string | undefined {
    const raw = event.raw;
    if (
      raw !== null &&
      typeof raw === "object" &&
      "traceId" in raw &&
      typeof (raw as Record<string, unknown>).traceId === "string"
    ) {
      return (raw as Record<string, string>).traceId;
    }
    return undefined;
  }

  private emitFailure(
    event: NormalizedEvent,
    url: string,
    errorMessage: string,
    attempt: number,
  ): void {
    // Persist the dead-lettered event before announcing the terminal failure so
    // `webhook.failed` consumers can correlate via `dlqId`.
    const dlqId = this.dlq.add(url, event, errorMessage, attempt);
    this.config.metrics?.recordTerminal(url, "failure");
    this.watcher.emit("webhook.failed", {
      ...event,
      raw: {
        error: errorMessage,
        url,
        attempts: attempt,
        originalEvent: event,
        dlqId,
      } satisfies WebhookFailureRaw,
    } as unknown as NormalizedEvent);
  }

  /**
   * Dispatches a first-attempt delivery through the concurrency cap.
   * If at capacity, the event is queued and a `webhook.backpressure` notification is emitted.
   */
  private dispatchDelivery(event: NormalizedEvent, url: string): void {
    if (this.activeDeliveries >= this.config.maxConcurrentDeliveries) {
      this.overflowQueue.push({ event, url });
      this.emitBackpressure(event, url);
      return;
    }
    this.activeDeliveries++;
    this.deliverToUrl(event, url).finally(() => {
      this.activeDeliveries--;
      this.drainOverflowQueue();
    });
  }

  /**
   * Drains the overflow queue into active delivery slots until the cap is reached
   * or the queue is empty.
   */
  private drainOverflowQueue(): void {
    while (
      this.overflowQueue.length > 0 &&
      this.activeDeliveries < this.config.maxConcurrentDeliveries
    ) {
      const { event, url } = this.overflowQueue.shift()!;
      this.activeDeliveries++;
      this.deliverToUrl(event, url).finally(() => {
        this.activeDeliveries--;
        this.drainOverflowQueue();
      });
    }
  }

  /** Emits `webhook.backpressure` when the delivery cap is exceeded. */
  private emitBackpressure(event: NormalizedEvent, url: string): void {
    this.watcher.emit("webhook.backpressure", {
      ...event,
      raw: {
        reason: "concurrent_delivery_cap_exceeded",
        url,
        maxConcurrentDeliveries: this.config.maxConcurrentDeliveries,
        pendingCount: this.overflowQueue.length,
        originalEvent: event,
      } satisfies WebhookBackpressureRaw,
    } as unknown as NormalizedEvent);
  }

  private clearRetryTimers(): void {
    for (const timer of this.retryTimers.keys()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    for (const timer of this.queueDrainTimers) {
      clearTimeout(timer);
    }
    this.queueDrainTimers.clear();
  }

  /** Emits `webhook.dropped` and dead-letters an event shed by the retry cap. */
  private emitDropped(event: NormalizedEvent, url: string): void {
    this.config.metrics?.recordTerminal(url, "dropped");
    this.dlq.add(url, event, "retry_cap_exceeded", 0);
    this.watcher.emit("webhook.dropped", {
      ...event,
      raw: {
        reason: "retry_cap_exceeded",
        url,
        maxConcurrentRetries: this.config.maxConcurrentRetries,
        originalEvent: event,
      } satisfies WebhookDroppedRaw,
    } as unknown as NormalizedEvent);
  }

  /**
   * Persists a pending retry to the durable queue and schedules a drain at its
   * due time. The retry cap is enforced against the queue's `size()`, shedding
   * the newest (furthest-future) record via `evictNewest()` when at the limit.
   */
  private async persistRetry(
    queue: RetryQueue,
    event: NormalizedEvent,
    url: string,
    attempt: number,
    lastError: string,
  ): Promise<void> {
    if ((await queue.size()) >= this.config.maxConcurrentRetries) {
      const evicted = await queue.evictNewest();
      if (evicted) {
        this.emitDropped(evicted.event as NormalizedEvent, evicted.url);
      }
    }

    const delay = this.config.backoff(attempt - 1, this.config.random);
    const record: RetryRecord<NormalizedEvent> = {
      id: `retry-${Date.now()}-${this.retrySeq++}`,
      event,
      url,
      attempt,
      nextRetryAt: Date.now() + delay,
      lastError,
      createdAt: Date.now(),
    };
    await queue.enqueue(record);

    // Auto-drive the redelivery without requiring an external scheduler.
    const timer = setTimeout(() => {
      this.queueDrainTimers.delete(timer);
      void this.drainDueRetries();
    }, delay);
    this.queueDrainTimers.add(timer);
  }

  /**
   * Drains all currently-due records from the configured retry queue, redelivering
   * each and acknowledging it. A redelivery that fails again re-persists itself
   * (with the next backoff) via {@link deliverToUrl}, so this loop terminates once
   * no record is due. Safe to call from a scheduler or on process startup to
   * resume retries persisted before a restart.
   */
  async drainDueRetries(nowMs: number = Date.now()): Promise<void> {
    const queue = this.config.retryQueue;
    if (!queue) return;

    for (;;) {
      if (this.watcher.stopped) return;
      const record = await queue.dequeue(nowMs);
      if (!record) return;
      await this.deliverToUrl(record.event as NormalizedEvent, record.url, record.attempt);
      await queue.ack(record.id);
    }
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error && err.name === "AbortError") {
      return `Delivery timed out after ${this.config.deliveryTimeoutMs}ms`;
    }

    return err instanceof Error ? err.message : "Unknown error";
  }

  private sign(payload: string, timestamp: string): string {
    const signedPayload = `${timestamp}.${payload}`;

    return createHmac("sha256", this.config.secret).update(signedPayload).digest("hex");
  }
}

export function verifyWebhook(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  options: VerifyWebhookOptions = {},
): NormalizedEvent | null {
  // Enforce maximum body size before any cryptographic work.
  const maxBodyBytes = options.maxBodyBytes ?? 100_000;
  if (Buffer.byteLength(payload, "utf8") > maxBodyBytes) return null;

  if (!verifyWebhookRaw(payload, signature, secret, timestamp, options)) return null;
  try {
    const evt = JSON.parse(payload) as NormalizedEvent;
    if (options.schema) {
      try {
        if (!options.schema(evt)) return null;
      } catch {
        return null;
      }
    }
    return evt;
  } catch {
    return null;
  }
}

/**
 * Verifies webhook signature without parsing JSON.
 * Use when routing the raw body to another consumer (e.g., a queue) to avoid the parse overhead.
 */
export function verifyWebhookRaw(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  options: VerifyWebhookOptions = {},
): boolean {
  if (!/^\d+$/.test(timestamp)) return false;

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) return false;

  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const nowMs = options.nowMs ?? Date.now();

  if (timestampMs > nowMs + clockSkewMs) return false;
  if (timestampMs < nowMs - maxAgeMs - clockSkewMs) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}
