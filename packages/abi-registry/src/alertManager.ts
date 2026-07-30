import type { VerdictRecord } from "./verdictStore.js";

export interface AlertManager {
  alertTransition(previous: VerdictRecord, current: VerdictRecord): Promise<void>;
}

export class ConsoleAlertManager implements AlertManager {
  async alertTransition(previous: VerdictRecord, current: VerdictRecord): Promise<void> {
    console.error(
      `[ABI Registry Alert] Contract ${current.contractId}: status transitioned from "${previous.status}" to "${current.status}" at ${current.verifiedAt}`,
    );
    if (current.diffs && current.diffs.length > 0) {
      console.error(`[ABI Registry Alert] Diffs:`, JSON.stringify(current.diffs, null, 2));
    }
  }
}

export class NoopAlertManager implements AlertManager {
  async alertTransition(_previous: VerdictRecord, _current: VerdictRecord): Promise<void> {}
}
