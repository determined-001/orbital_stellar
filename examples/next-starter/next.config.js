/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship ESM built from TypeScript; transpiling them
  // here keeps `next dev` working against source in the monorepo.
  transpilePackages: [
    "@orbital-stellar/pulse-core",
    "@orbital-stellar/pulse-notify",
    "@orbital-stellar/abi-registry",
  ],
};

module.exports = nextConfig;
