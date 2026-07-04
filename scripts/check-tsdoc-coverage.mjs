#!/usr/bin/env node
/**
 * Reports public exports (from each package's entry points) that have no
 * TSDoc comment. Warn-only for now while the existing backlog is paid down —
 * does not fail the build. See issue #709.
 */
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..");

const packages = [
  {
    name: "pulse-core",
    tsconfig: "packages/pulse-core/tsconfig.json",
    entryPoints: ["packages/pulse-core/src/index.ts"],
  },
  {
    name: "pulse-webhooks",
    tsconfig: "packages/pulse-webhooks/tsconfig.json",
    entryPoints: ["packages/pulse-webhooks/src/index.ts"],
  },
  {
    name: "pulse-notify",
    tsconfig: "packages/pulse-notify/tsconfig.json",
    entryPoints: ["packages/pulse-notify/src/index.ts", "packages/pulse-notify/src/devtools.tsx"],
  },
];

function findMissingDocs(tsconfigPath, entryFiles) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
  );
  const program = ts.createProgram({ rootNames: entryFiles, options: parsed.options });
  const checker = program.getTypeChecker();
  const missing = [];

  for (const entryFile of entryFiles) {
    const sourceFile = program.getSourceFile(entryFile);
    const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;

    for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
      const resolved =
        exportSymbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exportSymbol)
          : exportSymbol;
      const hasDocs =
        exportSymbol.getDocumentationComment(checker).length > 0 ||
        resolved.getDocumentationComment(checker).length > 0;
      if (!hasDocs) {
        missing.push(`${path.relative(repoRoot, entryFile)}: ${exportSymbol.getName()}`);
      }
    }
  }
  return missing;
}

let total = 0;
for (const pkg of packages) {
  const missing = findMissingDocs(
    path.join(repoRoot, pkg.tsconfig),
    pkg.entryPoints.map((entry) => path.join(repoRoot, entry)),
  );
  total += missing.length;
  if (missing.length > 0) {
    console.log(`\n${pkg.name}: ${missing.length} public export(s) missing TSDoc`);
    for (const entry of missing) console.log(`  - ${entry}`);
  }
}

if (total > 0) {
  console.log(
    `\nTotal: ${total} public export(s) without TSDoc comments. (warning only, does not fail the build yet)`,
  );
} else {
  console.log("All public exports have TSDoc comments.");
}
