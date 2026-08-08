// The real `server-only` package throws on import outside a React Server
// Component graph, which would make every server-side module untestable.
// Vitest aliases the package to this no-op (see vitest.config.ts). The guard
// it provides is a build-time one that `next build` still enforces.
export {};
