import type { ContractSubscriptionFilter } from "./index.js";

/**
 * Validates a list of contract subscription filters according to Stellar RPC constraints:
 * - filters.length ≤ 5
 * - filter.contractIds.length ≤ 5
 * - Topic patterns must be string arrays where each segment is either '*', '**', or a base64-encoded XDR scval
 *
 * @param filters - The filters to validate
 * @returns null if valid, or an array of validation error messages if invalid
 */
export function validateContractFilters(
  filters: unknown
): string[] | null {
  const errors: string[] = [];

  // Check if filters is defined and is an array
  if (!Array.isArray(filters)) {
    return ["Filters must be an array"];
  }

  // Check filters.length ≤ 5
  if (filters.length > 5) {
    errors.push(
      `Filters array length must be ≤ 5, but got ${filters.length}`
    );
  }

  // Validate each filter object
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];

    // Check that filter is an object
    if (typeof filter !== "object" || filter === null) {
      errors.push(`Filter at index ${i} must be an object`);
      continue;
    }

    const filterObj = filter as Record<string, unknown>;

    // Validate type field (optional, must be string if present)
    if ("type" in filterObj && filterObj.type !== undefined) {
      if (
        typeof filterObj.type !== "string" ||
        !["contract.invoked", "contract.emitted"].includes(filterObj.type)
      ) {
        errors.push(
          `Filter[${i}].type must be "contract.invoked" or "contract.emitted"`
        );
      }
    }

    // Validate contractIds (optional, must be array of strings, length ≤ 5)
    if ("contractIds" in filterObj && filterObj.contractIds !== undefined) {
      if (!Array.isArray(filterObj.contractIds)) {
        errors.push(`Filter[${i}].contractIds must be an array`);
      } else {
        if (filterObj.contractIds.length > 5) {
          errors.push(
            `Filter[${i}].contractIds length must be ≤ 5, but got ${filterObj.contractIds.length}`
          );
        }

        for (let j = 0; j < filterObj.contractIds.length; j++) {
          const contractId = filterObj.contractIds[j];
          if (typeof contractId !== "string") {
            errors.push(
              `Filter[${i}].contractIds[${j}] must be a string`
            );
          }
        }
      }
    }

    // Validate topicFilters (optional, must be array of string|null)
    // Each string must be either '*', '**', or a base64-encoded XDR scval
    if ("topicFilters" in filterObj && filterObj.topicFilters !== undefined) {
      if (!Array.isArray(filterObj.topicFilters)) {
        errors.push(`Filter[${i}].topicFilters must be an array`);
      } else {
        for (let j = 0; j < filterObj.topicFilters.length; j++) {
          const topic = filterObj.topicFilters[j];

          // Topic can be null (wildcard) or string
          if (topic !== null && typeof topic !== "string") {
            errors.push(
              `Filter[${i}].topicFilters[${j}] must be null or a string`
            );
            continue;
          }

          // If it's a string, validate it's either '*', '**', or base64-encoded XDR scval
          if (typeof topic === "string") {
            if (topic !== "*" && topic !== "**") {
              // Check if it looks like base64-encoded XDR scval
              if (!isValidBase64XdrScval(topic)) {
                errors.push(
                  `Filter[${i}].topicFilters[${j}] must be '*', '**', or a base64-encoded XDR scval, but got '${topic}'`
                );
              }
            }
          }
        }
      }
    }
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Checks if a string appears to be valid base64-encoded XDR scval.
 * This is a basic check: the string should be non-empty, contain only base64 characters,
 * and have a length that's a multiple of 4 (or use padding).
 *
 * @param str - The string to validate
 * @returns true if it appears to be valid base64, false otherwise
 */
function isValidBase64XdrScval(str: string): boolean {
  if (!str || str.length === 0) {
    return false;
  }

  // Base64 alphabet: A-Z, a-z, 0-9, +, /, and optional = padding at the end
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) {
    return false;
  }

  // Check that padding is only at the end
  const paddingIndex = str.indexOf("=");
  if (paddingIndex !== -1) {
    // All characters after the first = should also be =
    for (let i = paddingIndex; i < str.length; i++) {
      if (str[i] !== "=") {
        return false;
      }
    }
  }

  return true;
}
