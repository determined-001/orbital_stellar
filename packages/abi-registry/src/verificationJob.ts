import type { ContractSpec } from "./spec.js";
import { verifySchema, type SchemaVerdict, type VerifySchemaOptions } from "./verifySchema.js";
import type { VerdictStore, VerdictRecord } from "./verdictStore.js";
import type { SpecStore, RegisteredSpec } from "./specStore.js";
import type { IssueReporter } from "./issueReporter.js";
import type { AlertManager } from "./alertManager.js";

export type VerificationJobConfig = {
  specStore: SpecStore;
  verdictStore: VerdictStore;
  verifyOptions: VerifySchemaOptions;
  issueReporter?: IssueReporter;
  alertManager?: AlertManager;
  onVerdict?: (record: VerdictRecord) => void;
};

export type JobResult = {
  total: number;
  verified: number;
  mismatch: number;
  unverifiable: number;
  errors: { contractId: string; error: string }[];
  issuesCreated: string[];
};

function verdictToStatus(verdict: SchemaVerdict): VerdictRecord["status"] {
  switch (verdict.status) {
    case "match":
      return "verified";
    case "mismatch":
      return "mismatch";
    case "unverifiable":
      return "unverifiable";
  }
}

export async function runVerificationJob(config: VerificationJobConfig): Promise<JobResult> {
  const result: JobResult = {
    total: 0,
    verified: 0,
    mismatch: 0,
    unverifiable: 0,
    errors: [],
    issuesCreated: [],
  };

  const specs = await config.specStore.getAll();
  result.total = specs.length;

  for (const registered of specs) {
    try {
      const record = await verifySingleContract(registered, config);
      if (record.status === "verified") result.verified++;
      else if (record.status === "mismatch") result.mismatch++;
      else if (record.status === "unverifiable") result.unverifiable++;

      config.onVerdict?.(record);

      if (record.status === "mismatch" && config.issueReporter) {
        const issueUrl = await config.issueReporter.reportMismatch({
          contractId: record.contractId,
          contractName: registered.spec.name,
          diffs: record.diffs ?? [],
          submittedVersion: registered.spec.version,
          previousStatus: record.previousStatus,
        });
        if (issueUrl) result.issuesCreated.push(issueUrl);
      }

      if (record.previousStatus && record.previousStatus !== record.status && config.alertManager) {
        const prevRecord: VerdictRecord = {
          contractId: record.contractId,
          status: record.previousStatus,
          verifiedAt: "",
        };
        await config.alertManager.alertTransition(prevRecord, record);
      }
    } catch (error) {
      result.errors.push({
        contractId: registered.contractId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

async function verifySingleContract(
  registered: RegisteredSpec,
  config: VerificationJobConfig,
): Promise<VerdictRecord> {
  const previous = await config.verdictStore.getLatest(registered.contractId);

  const submittedSpec: ContractSpec = {
    ...registered.spec,
    contractId: registered.contractId,
  };

  const verdict = await verifySchema(registered.contractId, submittedSpec, config.verifyOptions);

  const record: VerdictRecord = {
    contractId: registered.contractId,
    status: verdictToStatus(verdict),
    verifiedAt: new Date().toISOString(),
    previousStatus: previous?.status,
    specVersion: registered.spec.version,
  };

  if (verdict.status === "mismatch") {
    record.diffs = verdict.diffs;
  }
  if (verdict.status === "unverifiable") {
    record.reason = verdict.reason;
    record.attestedBy = registered.attestedBy;
  }

  await config.verdictStore.record(record);
  return record;
}
