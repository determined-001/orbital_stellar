export interface RawHorizonBaseOperation {
  id: string;
  paging_token: string;
  transaction_successful: boolean;
  source_account: string;
  created_at: string;
  type_i: number;
  _links: {
    self: { href: string };
    transaction: { href: string };
    effects: { href: string };
    succeeds: { href: string };
    precedes: { href: string };
  };
}

export interface RawHorizonPayment extends RawHorizonBaseOperation {
  type: "payment";
  to: string;
  from: string;
  amount: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface RawHorizonSetOptions extends RawHorizonBaseOperation {
  type: "set_options";
  signer_key?: string;
  signer_weight?: number;
  low_threshold?: number;
  med_threshold?: number;
  high_threshold?: number;
  master_key_weight?: number;
  home_domain?: string;
  set_flags?: number[];
  clear_flags?: number[];
  inflation_dest?: string;
}

export interface RawHorizonCreateAccount extends RawHorizonBaseOperation {
  type: "create_account";
  funder: string;
  account: string;
  starting_balance: string;
}

export interface RawHorizonManageSellOffer extends RawHorizonBaseOperation {
  type: "manage_sell_offer";
  offer_id: string | number;
  amount: string | number;
  buying_asset_type: string;
  buying_asset_code?: string;
  buying_asset_issuer?: string;
  selling_asset_type: string;
  selling_asset_code?: string;
  selling_asset_issuer?: string;
  price: string;
}

export interface RawHorizonManageBuyOffer extends RawHorizonBaseOperation {
  type: "manage_buy_offer";
  offer_id: string | number;
  amount: string | number;
  buying_asset_type: string;
  buying_asset_code?: string;
  buying_asset_issuer?: string;
  selling_asset_type: string;
  selling_asset_code?: string;
  selling_asset_issuer?: string;
  price: string;
}

export interface RawHorizonBumpSequence extends RawHorizonBaseOperation {
  type: "bump_sequence";
  bump_to: string;
}

export interface RawHorizonManageData extends RawHorizonBaseOperation {
  type: "manage_data";
  data_name: string;
  data_value: string | null;
}

export interface RawHorizonChangeTrust extends RawHorizonBaseOperation {
  type: "change_trust";
  limit: string | number;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface RawHorizonAccountMerge extends RawHorizonBaseOperation {
  type: "account_merge";
  account: string;
  into: string;
}

export interface RawHorizonCreateClaimableBalance extends RawHorizonBaseOperation {
  type: "create_claimable_balance";
  amount: string;
  balance_id: string;
  claimants: Array<{ destination: string; predicate: unknown }>;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface RawHorizonClaimClaimableBalance extends RawHorizonBaseOperation {
  type: "claim_claimable_balance";
  balance_id: string;
}

export interface RawHorizonLiquidityPoolDeposit extends RawHorizonBaseOperation {
  type: "liquidity_pool_deposit";
  liquidity_pool_id: string;
  shares_received: string;
  reserves_deposited: Array<{ asset: string; amount: string }>;
}

export interface RawHorizonLiquidityPoolWithdraw extends RawHorizonBaseOperation {
  type: "liquidity_pool_withdraw";
  liquidity_pool_id: string;
  shares: string;
  reserves_received: Array<{ asset: string; amount: string }>;
}

export interface RawHorizonAllowTrust extends RawHorizonBaseOperation {
  type: "allow_trust";
  trustor: string;
  trustee?: string;
  authorize: boolean;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface RawHorizonSetTrustLineFlags extends RawHorizonBaseOperation {
  type: "set_trust_line_flags";
  trustor: string;
  set_flags_s?: string[];
  clear_flags_s?: string[];
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}
