import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, waitFor } from "@testing-library/react";
import { StellarEventBoundary } from "../src/StellarEventBoundary.js";

describe("StellarEventBoundary", () => {
  it("renders fallback (not children) during real SSR, since useEffect never fires server-side", () => {
    const html = renderToStaticMarkup(
      <StellarEventBoundary fallback={<div>Loading…</div>}>
        <div>Live content</div>
      </StellarEventBoundary>,
    );

    expect(html).toContain("Loading");
    expect(html).not.toContain("Live content");
  });

  it("renders nothing during SSR by default when no fallback is provided", () => {
    const html = renderToStaticMarkup(
      <StellarEventBoundary>
        <div>Live content</div>
      </StellarEventBoundary>,
    );

    expect(html).toBe("");
  });

  it("renders children after mounting on the client", async () => {
    render(
      <StellarEventBoundary fallback={<div>Loading…</div>}>
        <div>Live content</div>
      </StellarEventBoundary>,
    );

    await waitFor(() => {
      expect(screen.getByText("Live content")).toBeTruthy();
    });
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
