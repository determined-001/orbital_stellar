export interface IssueReporter {
  reportMismatch(params: MismatchReportParams): Promise<string>;
}

export type MismatchReportParams = {
  contractId: string;
  contractName: string;
  diffs: { path: string; submitted: unknown; onChain: unknown }[];
  submittedVersion?: string;
  previousStatus?: string;
};

export class GitHubIssueReporter implements IssueReporter {
  constructor(
    private readonly token: string,
    private readonly repo: string,
  ) {}

  async reportMismatch(params: MismatchReportParams): Promise<string> {
    const title = `[ABI Registry] Schema mismatch detected for ${params.contractName} (${params.contractId.slice(0, 8)}…)`;
    const body = [
      `## ABI Schema Mismatch`,
      ``,
      `Contract **${params.contractName}** (\`${params.contractId}\`) has a submitted schema that does not match its on-chain contract spec.`,
      ``,
      `| Field | Detail |`,
      `|---|---|`,
      `| **Contract** | \`${params.contractId}\` |`,
      `| **Name** | ${params.contractName} |`,
      params.submittedVersion ? `| **Submitted version** | ${params.submittedVersion} |` : null,
      params.previousStatus ? `| **Previous verdict** | ${params.previousStatus} |` : null,
      ``,
      `### Differences`,
      ``,
      params.diffs.length === 0
        ? `No specific field diffs recorded.`
        : `| # | Path | Submitted | On-chain |`,
      `|---|---|---|---|`,
    ].concat(
      params.diffs.map(
        (d, i) =>
          `| ${i + 1} | \`${d.path}\` | \`${JSON.stringify(d.submitted)}\` | \`${JSON.stringify(d.onChain)}\` |`,
      ),
    );

    body.push(``, `---`, `_Automatically reported by ABI Registry Verification Pipeline_`);

    const response = await fetch(`https://api.github.com/repos/${this.repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        title,
        body: body.filter(Boolean).join("\n"),
        labels: ["abi-registry", "schema-mismatch", "automated"],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown");
      throw new Error(`GitHubIssueReporter: failed to create issue (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { html_url?: string };
    return data.html_url ?? `https://github.com/${this.repo}/issues`;
  }
}

export class NoopIssueReporter implements IssueReporter {
  async reportMismatch(_params: MismatchReportParams): Promise<string> {
    return "";
  }
}
