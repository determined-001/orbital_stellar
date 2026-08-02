/**
 * Small string helpers used by the clients.
 *
 * These exist as index scans rather than regexes on purpose: patterns like
 * `/\/+$/` and `/\s+#.*$/` backtrack polynomially on adversarial input (a long
 * run of slashes or whitespace), and every input here comes from a remote
 * anchor or a caller-supplied URL. CodeQL flags exactly this as
 * `js/polynomial-redos`.
 */

/** Removes any trailing `/` characters. Linear time, no backtracking. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) {
    end--;
  }
  return value.slice(0, end);
}

/** Removes a leading `http://` or `https://`, case-insensitively. */
export function stripScheme(value: string): string {
  const lower = value.toLowerCase();
  if (lower.startsWith("https://")) return value.slice(8);
  if (lower.startsWith("http://")) return value.slice(7);
  return value;
}

/**
 * Trims a TOML value, dropping an inline `# comment`.
 *
 * Only a `#` preceded by whitespace starts a comment, so a `#` inside a quoted
 * value survives.
 */
export function stripInlineComment(value: string): string {
  for (let index = 1; index < value.length; index++) {
    if (value[index] !== "#") continue;
    const previous = value.charCodeAt(index - 1);
    if (previous === 32 /* space */ || previous === 9 /* tab */) {
      return value.slice(0, index).trim();
    }
  }
  return value.trim();
}
