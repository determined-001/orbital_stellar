# @orbital-stellar/anchor-sdk

**Typed clients for talking to Stellar anchors.** Discovery, SEP-10 authentication, SEP-12 KYC, SEP-24 interactive deposit/withdraw, and SEP-31 cross-border payments - each with a validated request/response shape instead of hand-rolled `fetch` calls.

```bash
pnpm add @orbital-stellar/anchor-sdk
```

## What it does

`anchor-sdk` is the client side of the SEP anchor protocols. You point it at an anchor's home domain, it discovers the endpoints from `stellar.toml`, authenticates, and drives the deposit/withdraw or cross-border payment flow - each response validated against a `zod` schema so a malformed anchor reply throws instead of silently propagating `undefined`.

It never holds a Stellar secret key. Every flow that needs a signature takes a caller-supplied signing callback, so the key can live in a hardware wallet, a KMS, or wherever the consumer already keeps it - the SDK only ever sees signed XDR.

## SEP-1 - discovery

```ts
import { discoverAnchor } from "@orbital-stellar/anchor-sdk";

const toml = await discoverAnchor("anchor.example.com");
// toml.WEB_AUTH_ENDPOINT, toml.TRANSFER_SERVER_SEP0024, toml.SIGNING_KEY, ...
```

`discoverAnchor` fetches `https://{homeDomain}/.well-known/stellar.toml`, caps the response at 100 KB, and parses only the top-level keys this SDK understands. A response that isn't reachable, isn't valid, or exceeds the size cap throws `Sep1DiscoveryError`.

## SEP-10 - authentication

```ts
import { discoverAnchor, Sep10Client } from "@orbital-stellar/anchor-sdk";
import { Keypair } from "@stellar/stellar-sdk";

const toml = await discoverAnchor("anchor.example.com");
const client = Sep10Client.fromToml(toml, "anchor.example.com");

const keypair = Keypair.fromSecret(process.env.STELLAR_SECRET!);

const token = await client.authenticate({
  account: keypair.publicKey(),
  sign: async (challenge) => {
    // Sign with whatever holds your key - here, an in-process Keypair.
    const tx = /* build a Transaction from challenge.transaction */;
    tx.sign(keypair);
    return tx.toXDR();
  },
});
```

Every challenge is validated against the anchor's `SIGNING_KEY`, network passphrase, home domain, and `web_auth_domain` **before** it reaches your `sign` callback - a hostile or compromised anchor cannot get an arbitrary transaction signed by handing you a "challenge" that is actually a payment or a `set_options` adding a signer. `Sep10Client.fromToml` is the preferred constructor: it's the path that cannot forget to pass `SIGNING_KEY`, without which no challenge can be attributed to the anchor.

## SEP-12 - KYC

```ts
import { Sep12Client } from "@orbital-stellar/anchor-sdk";

const kyc = new Sep12Client(toml.KYC_SERVER!);
const info = await kyc.getCustomer({ account: keypair.publicKey() }, token);

if (info.status === "NEEDS_INFO") {
  const form = new FormData();
  form.set("first_name", "Jane");
  form.set("last_name", "Doe");
  await kyc.putCustomer(form, token);
}
```

## SEP-24 - interactive deposit / withdraw

```ts
import { Sep24Client, Sep24StatusMachine } from "@orbital-stellar/anchor-sdk";

const transfer = new Sep24Client(toml.TRANSFER_SERVER_SEP0024!);

const { url, id } = await transfer.initiateDeposit(
  { asset_code: "USDC" },
  token,
);
// Open `url` in a webview so the user completes the anchor's flow.

const machine = new Sep24StatusMachine();
const { status } = await transfer.transaction(id, token);
machine.transitionTo(status); // throws InvalidSep24TransitionError on an illegal jump
```

`Sep24StatusMachine` tracks one transaction's lifecycle and rejects transitions the spec doesn't allow (e.g. leaving a terminal status), so a buggy poll loop can't silently mark a refunded deposit as completed. Re-applying the same status is a no-op, since anchors commonly re-report an unchanged status on every poll.

## SEP-31 - cross-border payments

```ts
import { Sep31Client } from "@orbital-stellar/anchor-sdk";

const sep31 = new Sep31Client(toml.DIRECT_PAYMENT_SERVER!);
const info = await sep31.info();

const { id, stellar_account_id, stellar_memo } = await sep31.initiateTransaction(
  { asset_code: "USDC", receiver_id: "..." },
  token,
);
// Pay stellar_account_id with memo stellar_memo, then poll:
const tx = await sep31.pollStatus(id, token);
```

`sep31.sep12` is a bound `Sep12Client` for the same anchor, for when a SEP-31 flow needs sender/receiver KYC. `initiateTransaction` throws `MissingFieldsError` or `CustomerInfoNeededError` when the anchor needs more information before it will proceed.

## Normalizing anchor events

```ts
import { normalizeAnchorEvent } from "@orbital-stellar/anchor-sdk";

const event = normalizeAnchorEvent(sep24Transaction);
// event.type is one of the `anchor.*` lifecycle events from @orbital-stellar/pulse-core
```

Maps a SEP-24 or SEP-31 transaction onto the `anchor.*` taxonomy in `@orbital-stellar/pulse-core`. The anchor's own status is always preserved verbatim in `protocolStatus` - the normalized `type` is a convenience layer, never a replacement, so a compliance consumer can still see exactly what the anchor said. `settlementTxHash` is only ever a hash the anchor actually published; it is `null` rather than guessed when the anchor doesn't expose one.

## License

MIT, see [LICENSE](./LICENSE).
