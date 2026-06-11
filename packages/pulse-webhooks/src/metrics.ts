import type { WebhookAttemptStatus, WebhookMetrics, WebhookTerminalOutcome } from "./types.js";

export const NOOP_WEBHOOK_METRICS: WebhookMetrics = {
  recordAttempt: () => undefined,
  recordTerminal: () => undefined,
};

export class CountingWebhookMetrics implements WebhookMetrics {
  private readonly attemptsByUrl = new Map<
    string,
    Array<{
      attempt: number;
      durationMs: number;
      status: WebhookAttemptStatus;
    }>
  >();
  private readonly terminalOutcomes = new Map<string, WebhookTerminalOutcome>();

  recordAttempt(
    url: string,
    attempt: number,
    durationMs: number,
    status: WebhookAttemptStatus,
  ): void {
    const existing = this.attemptsByUrl.get(url) ?? [];
    existing.push({ attempt, durationMs, status });
    this.attemptsByUrl.set(url, existing);
  }

  recordTerminal(url: string, outcome: WebhookTerminalOutcome): void {
    this.terminalOutcomes.set(url, outcome);
  }

  getAttempts(url: string): Array<{
    attempt: number;
    durationMs: number;
    status: WebhookAttemptStatus;
  }> {
    return [...(this.attemptsByUrl.get(url) ?? [])];
  }

  getTerminalOutcome(url: string): WebhookTerminalOutcome | undefined {
    return this.terminalOutcomes.get(url);
  }
}
