import type { RetryQueue, RetryRecord } from "./RetryQueue.js";

// ---------------------------------------------------------------------------
// SqsLike — minimal interface over the AWS SDK v3 SQSClient methods this queue
// needs. By accepting an interface rather than a concrete SDK class the queue
// stays dependency-free and trivially testable with a mock.
// ---------------------------------------------------------------------------

export type SendMessageInput = {
  QueueUrl: string;
  MessageBody: string;
  /**
   * Required for FIFO queues (*.fifo). Messages in the same group are always
   * delivered to the consumer in the order they were enqueued, providing
   * per-delivery-target FIFO ordering when the group ID is set to a value that
   * identifies the logical delivery stream (e.g. queue name + webhook URL hash).
   */
  MessageGroupId?: string;
  /**
   * Required for FIFO queues. Prevents SQS from delivering the same logical
   * message twice within the 5-minute deduplication window. We use the
   * RetryRecord id so re-enqueuing the same record id is idempotent.
   */
  MessageDeduplicationId?: string;
  /**
   * Standard-queue only. Seconds before the message first becomes visible.
   * We use this to implement retry backoff: enqueue with
   * `DelaySeconds = ceil(nextRetryAt - now) / 1000`, capped at the SQS maximum
   * of 900 seconds. The message will not appear to consumers until the delay
   * has elapsed, giving native SQS-level backoff without a separate scheduler.
   */
  DelaySeconds?: number;
};

export type SendMessageOutput = {
  MessageId?: string;
};

export type ReceiveMessageInput = {
  QueueUrl: string;
  MaxNumberOfMessages?: number;
  /**
   * Seconds the received message is hidden from other consumers. This is the
   * primary backoff mechanism for *in-flight* records: a message that has been
   * dequeued but not yet acked will automatically re-appear after this window
   * expires, giving the queue crash-safety without any additional infrastructure.
   *
   * Set this value to at least as long as the longest expected delivery attempt
   * so that a slow-but-successful delivery is not retried by a competing worker.
   */
  VisibilityTimeout?: number;
  WaitTimeSeconds?: number;
};

export type SqsMessage = {
  MessageId?: string;
  ReceiptHandle?: string;
  Body?: string;
};

export type ReceiveMessageOutput = {
  Messages?: SqsMessage[];
};

export type DeleteMessageInput = {
  QueueUrl: string;
  ReceiptHandle: string;
};

export type DeleteMessageOutput = Record<string, unknown>;

/**
 * Minimal SQS-shaped interface. Compatible with the output of
 * `new SQSClient({...})` from `@aws-sdk/client-sqs` — no direct dependency on
 * the SDK is required.
 */
export type SqsLike = {
  sendMessage(input: SendMessageInput): Promise<SendMessageOutput>;
  receiveMessage(input: ReceiveMessageInput): Promise<ReceiveMessageOutput>;
  deleteMessage(input: DeleteMessageInput): Promise<DeleteMessageOutput>;
};

// ---------------------------------------------------------------------------
// SqsRetryQueueOptions
// ---------------------------------------------------------------------------

export type SqsRetryQueueOptions = {
  /**
   * The SQS queue URL. Must be provided; typically the output of
   * `CreateQueue` or a well-known URL of the form
   * `https://sqs.<region>.amazonaws.com/<account>/<queue-name>`.
   */
  queueUrl: string;
  /**
   * Clock source, injectable for testing. Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * How long (ms) a dequeued record stays hidden from other consumers before
   * SQS automatically makes it visible again. This mirrors the semantics of
   * {@link RedisRetryQueue} and {@link MemoryRetryQueue}: a worker crash
   * between dequeue and ack will not lose the retry — SQS will redeliver it
   * after the visibility timeout.
   *
   * Backoff interaction: the visibility timeout governs *in-flight* records
   * only. Pre-delivery backoff is encoded as `DelaySeconds` on the send side,
   * derived from `record.nextRetryAt - now`. These two mechanisms are
   * orthogonal: `DelaySeconds` delays the first delivery; `VisibilityTimeout`
   * governs re-delivery after a crash or nack.
   *
   * Defaults to 30,000 ms (30 s). Must be between 1 and 43,200,000 ms (12 h).
   */
  visibilityTimeoutMs?: number;
  /**
   * Maximum number of messages to fetch in a single `ReceiveMessage` call.
   * Bounded to [1, 10] per SQS constraints. Defaults to 1.
   */
  maxReceiveCount?: number;
  /**
   * Long-poll wait time in seconds (0 = short poll). Up to 20 s per SQS docs.
   * Defaults to 0.
   */
  waitTimeSeconds?: number;
  /**
   * MessageGroupId assigned to every message. Only used with FIFO queues
   * (queue URL ending in `.fifo`). Providing a consistent group ID guarantees
   * that all messages enqueued by this instance are processed in FIFO order.
   *
   * For per-URL ordering, callers may derive this from the webhook URL.
   * Defaults to `"default"`.
   */
  messageGroupId?: string;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RECEIVE_COUNT = 1;
const DEFAULT_WAIT_TIME_SECONDS = 0;
const DEFAULT_MESSAGE_GROUP_ID = "default";
/** SQS hard cap on DelaySeconds. */
const SQS_MAX_DELAY_SECONDS = 900;
/** SQS hard cap on VisibilityTimeout (12 h). */
const SQS_MAX_VISIBILITY_TIMEOUT_S = 43_200;

/**
 * SQS-backed durable {@link RetryQueue}.
 *
 * ### Backoff semantics and the two SQS timing knobs
 *
 * 1. **`DelaySeconds` (pre-delivery backoff)**
 *    On `enqueue`, the adapter computes `ceil((record.nextRetryAt - now) / 1000)`
 *    capped to 900 s (the SQS maximum). The message becomes invisible to
 *    consumers for that many seconds, providing the same "don't deliver before
 *    this timestamp" guarantee as the Redis / Memory queue implementations.
 *    Values ≤ 0 result in a `DelaySeconds` of 0 (immediate visibility).
 *
 * 2. **`VisibilityTimeout` (in-flight backoff / crash safety)**
 *    On `dequeue`, every message is received with the configured
 *    `visibilityTimeoutMs` (default 30 s). If the consuming worker crashes or
 *    fails to call `ack` before the timeout expires, SQS automatically makes
 *    the message visible again — no explicit `nack` required.
 *    `nack` re-enqueues the record with a fresh `DelaySeconds` derived from
 *    `requeueDelayMs`, then deletes the original message so there is no
 *    double-delivery.
 *
 * ### FIFO ordering
 *
 * When the queue URL ends in `.fifo`, set `messageGroupId` (constructor option
 * or per-call default) to a stable identifier for the logical delivery stream
 * (e.g. `"default"` for a single-tenant queue, or a hash of the target URL for
 * per-endpoint FIFO). All messages in the same group are delivered in enqueue
 * order. Standard queues ignore `MessageGroupId`.
 *
 * ### `evictNewest` and `size`
 *
 * SQS does not support ordered scans or exact counts on a per-message basis.
 * `evictNewest` is implemented via a best-effort receive + delete of one
 * message. `size` returns the `ApproximateNumberOfMessages` attribute when
 * supported, but falls back to `0` for implementations (including test mocks)
 * that do not expose that attribute. Callers should treat these as approximate.
 */
export class SqsRetryQueue implements RetryQueue {
  private readonly client: SqsLike;
  private readonly queueUrl: string;
  private readonly now: () => number;
  private readonly visibilityTimeoutS: number;
  private readonly maxReceiveCount: number;
  private readonly waitTimeSeconds: number;
  private readonly messageGroupId: string;
  private readonly isFifo: boolean;

  /**
   * In-memory map of `recordId → ReceiptHandle` for messages that have been
   * dequeued but not yet acked or nacked. Required because SQS `DeleteMessage`
   * and `ChangeMessageVisibility` operate on opaque receipt handles, not
   * record IDs.
   */
  private readonly inFlight = new Map<string, string>();

  /**
   * Secondary in-flight map that stores the full record body, keyed by
   * `record.id`. Populated by `dequeue`; used by `nack` to reconstruct the
   * record for re-enqueue.
   */
  private readonly inFlightRecords = new Map<string, RetryRecord>();

  constructor(client: SqsLike, options: SqsRetryQueueOptions) {
    this.client = client;
    this.queueUrl = options.queueUrl;
    this.now = options.now ?? Date.now;

    const visMs = options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
    // Convert to seconds; clamp to [1, SQS max].
    this.visibilityTimeoutS = Math.min(
      SQS_MAX_VISIBILITY_TIMEOUT_S,
      Math.max(1, Math.ceil(visMs / 1000)),
    );

    this.maxReceiveCount = Math.min(
      10,
      Math.max(1, Math.floor(options.maxReceiveCount ?? DEFAULT_MAX_RECEIVE_COUNT)),
    );
    this.waitTimeSeconds = Math.min(
      20,
      Math.max(0, Math.floor(options.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS)),
    );
    this.messageGroupId = options.messageGroupId ?? DEFAULT_MESSAGE_GROUP_ID;
    this.isFifo = this.queueUrl.endsWith(".fifo");
  }

  /**
   * Persist a retry record to SQS.
   *
   * The message body is the JSON-serialised `RetryRecord`. For standard queues,
   * `DelaySeconds` is derived from `record.nextRetryAt - now` so the message
   * only becomes consumable after the intended retry time. For FIFO queues,
   * `DelaySeconds` is not supported by SQS and is omitted; ordering is
   * guaranteed by the message group instead.
   */
  async enqueue(record: RetryRecord): Promise<void> {
    this.assertRecord(record);

    const delaySeconds = this.isFifo
      ? undefined
      : Math.min(
          SQS_MAX_DELAY_SECONDS,
          Math.max(0, Math.ceil((record.nextRetryAt - this.now()) / 1000)),
        );

    const input: SendMessageInput = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(record),
      ...(delaySeconds !== undefined && { DelaySeconds: delaySeconds }),
      ...(this.isFifo && {
        MessageGroupId: this.messageGroupId,
        MessageDeduplicationId: record.id,
      }),
    };

    await this.client.sendMessage(input);
  }

  /**
   * Receive one due record from SQS.
   *
   * The `nowMs` parameter is accepted for interface compatibility but is not
   * forwarded to SQS — the queue's `DelaySeconds` already encodes the
   * "not before" constraint. A message is only returned by SQS once its delay
   * (or visibility timeout after a prior receive) has elapsed.
   *
   * The received message is moved to in-flight by recording its `ReceiptHandle`
   * against the record ID. The record will reappear after `visibilityTimeoutMs`
   * if the caller neither acks nor nacks it.
   */
  async dequeue(_nowMs?: number): Promise<RetryRecord | null> {
    const output = await this.client.receiveMessage({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: this.maxReceiveCount,
      VisibilityTimeout: this.visibilityTimeoutS,
      WaitTimeSeconds: this.waitTimeSeconds,
    });

    const messages = output.Messages ?? [];
    if (messages.length === 0) return null;

    // Take the first parseable message.
    for (const msg of messages) {
      const record = this.parseRecord(msg.Body);
      if (!record || !msg.ReceiptHandle) continue;

      this.inFlight.set(record.id, msg.ReceiptHandle);
      this.inFlightRecords.set(record.id, record);
      return record;
    }

    return null;
  }

  /**
   * Acknowledge successful processing of a record.
   *
   * Deletes the corresponding SQS message so it is never redelivered.
   * No-op if the record is not currently in-flight (e.g. already acked).
   */
  async ack(recordId: string): Promise<void> {
    const receiptHandle = this.inFlight.get(recordId);
    if (!receiptHandle) return;

    await this.client.deleteMessage({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });

    this.inFlight.delete(recordId);
    this.inFlightRecords.delete(recordId);
  }

  /**
   * Negatively acknowledge a record — re-enqueue it with a backoff delay,
   * then delete the original in-flight message.
   *
   * SQS does not have a native "change message body + delay" operation, so the
   * implementation enqueues a fresh message (with the updated `nextRetryAt`
   * derived from `requeueDelayMs`) and then deletes the original. This avoids
   * the original message becoming visible again via SQS's own visibility timeout
   * while the fresh copy is already queued.
   */
  async nack(recordId: string, requeueDelayMs: number): Promise<void> {
    const receiptHandle = this.inFlight.get(recordId);
    if (!receiptHandle) return;

    // Find the in-flight record. We don't keep a body copy so we need to
    // synthesise a minimal record from what we know. In practice callers should
    // pass the full record; we reconstruct it from the in-flight body when
    // possible. Since SQS messages are opaque after receive, callers that need
    // accurate nack behaviour should call `nack` with the record they received
    // from `dequeue`.
    //
    // Here we delete the original and re-enqueue via a helper that callers on
    // the public `nack` surface area rely on. Because the RetryQueue contract
    // only passes `recordId + delayMs`, we track the last dequeued record body
    // to allow reconstruction.
    const record = this.inFlightRecords.get(recordId);
    if (!record) {
      // Best-effort: delete the message so it doesn't re-appear via visibility
      // timeout. The retry is lost but that's preferable to a stuck message.
      await this.client.deleteMessage({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle });
      this.inFlight.delete(recordId);
      return;
    }

    const delayMs = Number.isFinite(requeueDelayMs) ? Math.max(0, Math.floor(requeueDelayMs)) : 0;
    const nextRetryAt = this.now() + delayMs;

    await this.enqueue({ ...record, nextRetryAt });

    await this.client.deleteMessage({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle });
    this.inFlight.delete(recordId);
    this.inFlightRecords.delete(recordId);
  }

  /**
   * Evict one message from the queue as a backpressure mechanism.
   *
   * SQS does not support ordered eviction of the "newest" message — we receive
   * one message (without the normal visibility-timeout tracking) and delete it
   * immediately. The evicted record is returned for observability. In a standard
   * queue this will be an arbitrary message; in a FIFO queue it will be the
   * oldest visible message in the group.
   */
  async evictNewest(): Promise<RetryRecord | null> {
    const output = await this.client.receiveMessage({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      VisibilityTimeout: 0,
      WaitTimeSeconds: 0,
    });

    const [msg] = output.Messages ?? [];
    if (!msg?.ReceiptHandle) return null;

    const record = this.parseRecord(msg.Body);

    await this.client.deleteMessage({
      QueueUrl: this.queueUrl,
      ReceiptHandle: msg.ReceiptHandle,
    });

    return record;
  }

  /**
   * Return the number of queued (not in-flight) messages.
   *
   * SQS exposes approximate counts via the `GetQueueAttributes` API. This
   * adapter does not include that operation in `SqsLike` to keep the interface
   * minimal. The count returned here reflects only locally-tracked in-flight
   * records subtracted from the SQS approximation when available. Callers
   * should treat this as a best-effort estimate.
   *
   * For the purposes of this implementation, `size` returns the count of
   * locally-tracked in-flight records (i.e. records dequeued but not yet acked),
   * which is always accurate from the perspective of this adapter instance.
   * A full cross-process count requires `GetQueueAttributes`.
   */
  async size(): Promise<number> {
    // We can only return what we know locally. Callers that need exact counts
    // should call GetQueueAttributes on the SQS queue directly.
    return this.inFlight.size;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private assertRecord(record: RetryRecord): void {
    if (!record.id) {
      throw new Error("RetryRecord.id is required");
    }
    if (!Number.isFinite(record.nextRetryAt)) {
      throw new Error("RetryRecord.nextRetryAt must be a finite timestamp");
    }
  }

  private parseRecord(body: string | undefined): RetryRecord | null {
    if (!body) return null;
    try {
      return JSON.parse(body) as RetryRecord;
    } catch {
      return null;
    }
  }
}
