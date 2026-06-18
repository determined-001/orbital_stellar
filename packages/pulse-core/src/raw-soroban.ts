export interface RawSorobanEvent {
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  pagingToken: string;
  topic: string[];
  value: string | { xdr: string } | Record<string, unknown>;
  txHash: string;
  inSuccessfulContractCall: boolean;
}
