import type { ExportLedger, ExportOperation, ExportTransaction } from "./types.js";

/**
 * Parsers that turn raw export JSON (Galexie ledger transform, or a CDP
 * history transform) into the canonical {@link ExportLedger} shape.
 *
 * Both parsers deliberately normalize assets to the same string form
 * (`"XLM"` for native, `"CODE:ISSUER"` for issued assets) so that downstream
 * canonicalization - and therefore the byte-identical verdict guarantee -
 * does not depend on which export produced the record.
 */

type RawAsset = Record<string, unknown> & {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
};

function assetString(asset: RawAsset): string {
  if (asset.asset_type === "native" || asset.asset_type === undefined) return "XLM";
  const code = asset.asset_code ?? "UNKNOWN";
  const issuer = asset.asset_issuer ?? "UNKNOWN";
  return `${code}:${issuer}`;
}

function galexieOperation(op: Record<string, unknown>): ExportOperation | null {
  const type = op.type;
  const amount = typeof op.amount === "string" ? op.amount : undefined;
  switch (type) {
    case "payment": {
      const asset = assetString(op.asset as RawAsset);
      return {
        kind: "payment",
        from: op.source_account as string,
        to: op.destination as string,
        amount: amount ?? "0",
        asset,
      };
    }
    case "mint":
    case "create_asset":
      return {
        kind: "mint",
        to: op.destination as string,
        amount: amount ?? "0",
        asset: assetString(op.asset as RawAsset),
      };
    case "burn":
      return {
        kind: "burn",
        from: op.source_account as string,
        amount: amount ?? "0",
        asset: assetString(op.asset as RawAsset),
      };
    case "clawback":
      return {
        kind: "clawback",
        from: op.source_account as string,
        amount: amount ?? "0",
        asset: assetString(op.asset as RawAsset),
      };
    case "fee":
      return { kind: "fee", from: op.source_account as string, amount: amount ?? "0" };
    case "set_authorized":
    case "allow_trust":
    case "set_trust_line_flags":
      return {
        kind: "set_authorized",
        trustor: op.trustor as string,
        asset: assetString(op.asset as RawAsset),
        authorized: Boolean(op.authorized),
      };
    default:
      return null;
  }
}

/** Parse one line of the Galexie "ledger" JSONL transform. */
export function parseGalexieLedger(json: unknown): ExportLedger {
  const rec = json as Record<string, unknown>;
  const transactionsRaw = (rec.transactions as unknown[]) ?? [];
  const transactions: ExportTransaction[] = transactionsRaw.map((t) => {
    const tx = t as Record<string, unknown>;
    const opsRaw = (tx.operations as unknown[]) ?? [];
    const operations: ExportOperation[] = [];
    for (const op of opsRaw) {
      const mapped = galexieOperation(op as Record<string, unknown>);
      if (mapped) operations.push(mapped);
    }
    return { transactionId: tx.transaction_id as string, operations };
  });
  return {
    ledgerSequence: rec.ledger_sequence as number,
    closeTime: rec.close_time as string,
    network: (rec.network as "mainnet" | "testnet") ?? "mainnet",
    transactions,
  };
}

function cdpOperation(op: Record<string, unknown>): ExportOperation | null {
  const type = op.op_type;
  const amount = typeof op.amount === "string" ? op.amount : undefined;
  const rawAsset = (op.asset ?? { asset_type: "native" }) as RawAsset;
  switch (type) {
    case "payment":
      return {
        kind: "payment",
        from: op.source as string,
        to: op.dest as string,
        amount: amount ?? "0",
        asset: assetString(rawAsset),
      };
    case "mint":
    case "create_asset":
      return {
        kind: "mint",
        to: op.dest as string,
        amount: amount ?? "0",
        asset: assetString(rawAsset),
      };
    case "burn":
      return {
        kind: "burn",
        from: op.source as string,
        amount: amount ?? "0",
        asset: assetString(rawAsset),
      };
    case "clawback":
      return {
        kind: "clawback",
        from: op.source as string,
        amount: amount ?? "0",
        asset: assetString(rawAsset),
      };
    case "fee":
      return { kind: "fee", from: op.source as string, amount: amount ?? "0" };
    case "set_authorized":
    case "allow_trust":
    case "set_trust_line_flags":
      return {
        kind: "set_authorized",
        trustor: op.trustor as string,
        asset: assetString(rawAsset),
        authorized: Boolean(op.authorized),
      };
    default:
      return null;
  }
}

/** Parse one record of the CDP "history" transform. */
export function parseCdpLedger(json: unknown): ExportLedger {
  const rec = json as Record<string, unknown>;
  const txsRaw = (rec.txs as unknown[]) ?? [];
  const transactions: ExportTransaction[] = txsRaw.map((t) => {
    const tx = t as Record<string, unknown>;
    const opsRaw = (tx.ops as unknown[]) ?? [];
    const operations: ExportOperation[] = [];
    for (const op of opsRaw) {
      const mapped = cdpOperation(op as Record<string, unknown>);
      if (mapped) operations.push(mapped);
    }
    return { transactionId: tx.hash as string, operations };
  });
  return {
    ledgerSequence: rec.ledger as number,
    closeTime: rec.closed_at as string,
    network: (rec.network as "mainnet" | "testnet") ?? "mainnet",
    transactions,
  };
}
