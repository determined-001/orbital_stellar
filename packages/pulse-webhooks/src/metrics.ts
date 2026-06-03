import type { WebhookMetrics } from "./types.js";

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
      status: "success" | "failure";
    }>
  >();
  private readonly terminalOutcomes = new Map<string, "success" | "failure">();

  recordAttempt(
    url: string,
    attempt: number,
    durationMs: number,
    status: "success" | "failure",
  ): void {
    const existing = this.attemptsByUrl.get(url) ?? [];
    existing.push({ attempt, durationMs, status });
    this.attemptsByUrl.set(url, existing);
  }

  recordTerminal(url: string, outcome: "success" | "failure"): void {
    this.terminalOutcomes.set(url, outcome);
  }

  getAttempts(url: string): Array<{
    attempt: number;
    durationMs: number;
    status: "success" | "failure";
  }> {
    return [...(this.attemptsByUrl.get(url) ?? [])];
  }

  getTerminalOutcome(url: string): "success" | "failure" | undefined {
    return this.terminalOutcomes.get(url);
  }
}
