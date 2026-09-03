import { describe, it, expect } from "vitest";
import { createParser } from "../src/cli/index.js";

/**
 * Drive the parser in-process. `exitProcess(false)` keeps a validation
 * failure from killing the test runner, and the callback captures the
 * error and the help/usage text yargs would have printed.
 */
async function parse(args: string[]): Promise<{ output: string; error?: Error }> {
  let error: Error | undefined;
  let output = "";
  await createParser(args)
    .exitProcess(false)
    .parseAsync(args, (err: Error | undefined, _argv: unknown, out: string) => {
      error = err ?? undefined;
      output = out ?? "";
    })
    .catch((err: Error) => {
      error = err;
    });
  return { output, error };
}

describe("orbital-worker cli", () => {
  it("prints help for every command", async () => {
    for (const command of ["register", "list", "inspect", "dry-run", "run"]) {
      const { output, error } = await parse([command, "--help"]);
      expect(error).toBeUndefined();
      expect(output).toContain(command);
      expect(output).toContain("--help");
    }
  });

  it("lists every command in the top-level help", async () => {
    const { output } = await parse(["--help"]);
    for (const command of ["register", "list", "inspect", "dry-run", "run"]) {
      expect(output).toContain(command);
    }
  });

  it("rejects a raw --secret value", async () => {
    const { error } = await parse(["register", "foo", "--secret", "rawsecret"]);
    // yargs swallows the coerce throw and surfaces the check() message.
    expect(error?.message).toContain("must reference env:VAR or file:PATH");
  });

  it("rejects an env: secret whose variable is unset", async () => {
    delete process.env.UNSET_TEST_VAR;
    const { error } = await parse(["register", "foo", "--secret", "env:UNSET_TEST_VAR"]);
    expect(error?.message).toContain("is not set");
  });

  it("demands a command", async () => {
    const { error } = await parse([]);
    expect(error?.message).toContain("You must specify a command");
  });
});
