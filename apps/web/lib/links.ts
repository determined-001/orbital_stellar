/**
 * Every off-page destination the marketing surface links to, in one place.
 *
 * These used to be inline `href="#"` placeholders scattered across `Nav`,
 * `Hero`, `Footer` and `DocNavbar` - sixteen of them, none of which went
 * anywhere, on pages whose destinations all already existed. Centralising them
 * means a renamed route breaks in one file instead of silently rotting in four,
 * and `npm`/GitHub URLs stay consistent with the published package names.
 */

/** Canonical repository. Matches the badges and clone URLs in the root README. */
export const GITHUB_REPO = "https://github.com/determined-001/orbital_stellar";

export const GITHUB_ISSUES = `${GITHUB_REPO}/issues/new/choose`;

/** The SCF grant proposal, rendered by GitHub - it is not part of the site's docs content. */
export const SCF_PROPOSAL = `${GITHUB_REPO}/blob/main/docs/proposal.md`;

/** Source tree for a starter under `examples/`. */
export function exampleTreeUrl(name: string): string {
  return `${GITHUB_REPO}/tree/main/examples/${name}`;
}

/**
 * Packages that are actually published, in dependency order - verified with
 * `npm view @orbital-stellar/<name> version`.
 *
 * `anchor-sdk` and `orbital-indexer` exist in `packages/` but are NOT on npm
 * yet (both 404 on the registry), so they are deliberately absent: linking them
 * would recreate the broken-link problem this list exists to fix. Add them here
 * when they ship.
 */
export const NPM_PACKAGES = [
  "pulse-core",
  "pulse-webhooks",
  "pulse-notify",
  "abi-registry",
] as const;

export function npmUrl(pkg: string): string {
  return `https://www.npmjs.com/package/@orbital-stellar/${pkg}`;
}

export type NavLink = {
  label: string;
  href: string;
  /** External links get `target="_blank"` and a noopener rel. */
  external?: boolean;
};

/** Primary navigation, shared by the landing page and `/starters`. */
export const NAV_LINKS: NavLink[] = [
  { label: "Docs", href: "/docs" },
  { label: "SDKs", href: "/reference" },
  { label: "Demo", href: "/demo/contracts" },
  { label: "Changelog", href: "/changelog" },
  { label: "GitHub", href: GITHUB_REPO, external: true },
];

export const GET_STARTED_HREF = "/docs/getting-started/quick-start";

export const FOOTER_PRODUCT_LINKS: NavLink[] = [
  { label: "Docs", href: "/docs" },
  { label: "SDKs", href: "/reference" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Live demo", href: "/demo/contracts" },
  { label: "Starters", href: "/starters" },
  { label: "Changelog", href: "/changelog" },
];

/**
 * No Twitter/X account exists for the project, so there is no entry for one.
 * An unlinked or invented handle is worse than an absent row.
 */
export const FOOTER_COMMUNITY_LINKS: NavLink[] = [
  { label: "GitHub", href: GITHUB_REPO, external: true },
  { label: "SCF Grant proposal", href: SCF_PROPOSAL, external: true },
  { label: "Open an issue", href: GITHUB_ISSUES, external: true },
];
