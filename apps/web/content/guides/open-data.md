# Open Data & Non-JS Consumption

Orbital's event taxonomy and entity labels are published as **open data** under the Creative Commons Zero v1.0 Universal (CC0) license. You do not need to install the JavaScript SDK or adopt Orbital's client libraries to consume this data.

Any tool, script, or framework in any programming language (Python, Rust, Go, cURL, etc.) can fetch, pin, and verify these artifacts via plain HTTP requests.

---

## Stable Endpoints

All artifacts are hosted at stable paths on the documentation site and attached to each tagged GitHub release:

| Artifact | Purpose | License | Web Path |
|---|---|---|---|
| `taxonomy.json` | Event taxonomy dictionary for classic operations and Soroban contract events | CC0-1.0 | `/data/taxonomy.json` |
| `labels.json` | Entity attributions and tags for well-known contracts and issuers | CC0-1.0 | `/data/labels.json` |
| `integrity.json` | Manifest containing SHA-256 digests and file sizes for pinning | CC0-1.0 | `/data/integrity.json` |
| `LICENSE` | CC0 1.0 Universal public domain dedication | CC0-1.0 | `/data/LICENSE` |

---

## Fetching with Plain HTTP Tools

### cURL

```bash
# Fetch event taxonomy
curl -sSL https://orbital-stellar.dev/data/taxonomy.json -o taxonomy.json

# Fetch entity labels
curl -sSL https://orbital-stellar.dev/data/labels.json -o labels.json

# Fetch integrity manifest
curl -sSL https://orbital-stellar.dev/data/integrity.json -o integrity.json
```

### Python

```python
import urllib.request
import json

# Download taxonomy
url = "https://orbital-stellar.dev/data/taxonomy.json"
response = urllib.request.urlopen(url)
taxonomy = json.loads(response.read().decode())

print(f"Schema Version: {taxonomy['schemaVersion']}")
print(f"Total Records: {taxonomy['recordCount']}")
for record in taxonomy['records'][:5]:
    print(f" - [{record['type']}] {record['id']}: {record['name']}")
```

### Rust

```rust
use serde::Deserialize;

#[derive(Deserialize, Debug)]
struct TaxonomyData {
    schemaVersion: String,
    generatedAt: String,
    recordCount: usize,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    const URL: &str = "https://orbital-stellar.dev/data/taxonomy.json";
    let data: TaxonomyData = reqwest::get(URL).await?.json().await?;
    println!("Loaded {} taxonomy records from {}", data.recordCount, URL);
    Ok(())
}
```

---

## Verifying Data Integrity (Pinning)

Consumers can verify that downloaded artifacts have not been tampered with or corrupted by validating their SHA-256 checksum against `integrity.json`:

```bash
# Calculate SHA-256 of taxonomy.json
sha256sum taxonomy.json

# Verify against SHA-256 reported in integrity.json
curl -sSL https://orbital-stellar.dev/data/integrity.json | jq '.files["taxonomy.json"].sha256'
```

---

## Schema Structure

### `taxonomy.json`

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-07-28T01:31:28.000Z",
  "recordCount": 43,
  "records": [
    {
      "id": "payment.received",
      "name": "Payment Received",
      "type": "classic",
      "category": "payments",
      "eventType": "payment.received",
      "description": "Normalized asset payment received by an account.",
      "source": "horizon"
    }
  ]
}
```

### `labels.json`

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-07-28T01:31:28.000Z",
  "recordCount": 5,
  "records": [
    {
      "contractId": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      "name": "USD Coin (USDC)",
      "description": "Circle's USD-backed stablecoin on Stellar mainnet, deployed as a Stellar Asset Contract (SAC).",
      "network": "mainnet",
      "tags": ["sep41", "sac", "stablecoin", "usd", "circle"],
      "category": "stablecoin",
      "verified": true
    }
  ]
}
```
