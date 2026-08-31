export type {
  ObservedTrade,
  CopyTradeSkipReason,
  CopyTradeSkipRecord,
  CopyTradeOutcome,
  RevocationCheck,
  CopyTradeWorkerConfig,
} from "./copyTrade.js";

export { createCopyTradeTrigger, computeMirroredSize, planCopyTrade } from "./copyTrade.js";
