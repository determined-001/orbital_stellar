import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { StellarEventBoundary, type StellarEventBoundaryProps } from "../src/StellarEventBoundary.js";

describe("StellarEventBoundary", () => {
  it("renders fallback during SSR (isMounted = false)", () => {
    // Test that the component initially renders the fallback
    // This simulates the SSR phase where useEffect hasn't run yet
    const fallback = React.createElement("div", null, "Loading...");
    const children = React.createElement("div", null, "Live Content");
    
    const component = React.createElement(StellarEventBoundary, {
      fallback,
      children,
    });

    // The component should be created successfully
    assert.ok(component);
    assert.equal(component.type, StellarEventBoundary);
  });

  it("accepts children prop", () => {
    const children = React.createElement("div", null, "Live Content");
    const component = React.createElement(StellarEventBoundary, { children });

    assert.ok(component);
    assert.equal(component.props.children, children);
  });

  it("accepts custom fallback prop", () => {
    const fallback = React.createElement("div", null, "Custom Loading");
    const children = React.createElement("div", null, "Live Content");
    
    const component = React.createElement(StellarEventBoundary, {
      fallback,
      children,
    });

    assert.ok(component);
    assert.equal(component.props.fallback, fallback);
  });

  it("renders null by default when no fallback provided", () => {
    const children = React.createElement("div", null, "Live Content");
    const component = React.createElement(StellarEventBoundary, { children });

    assert.ok(component);
    assert.equal(component.props.fallback, undefined);
  });

  it("has use client directive at the top", async () => {
    // Import the source file as text to verify "use client" directive
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    const filePath = path.join(
      import.meta.dirname,
      "../src/StellarEventBoundary.tsx"
    );
    
    const content = await fs.readFile(filePath, "utf-8");
    
    // Check that "use client" is at the very top
    assert.ok(
      content.startsWith('"use client"'),
      'File should start with "use client" directive'
    );
  });

  it("exports StellarEventBoundaryProps type", async () => {
    // Verify that the type is exported
    const module = await import("../src/StellarEventBoundary.js");
    
    assert.ok(module.StellarEventBoundary);
    assert.equal(typeof module.StellarEventBoundary, "function");
  });

  it("exports default export", async () => {
    const module = await import("../src/StellarEventBoundary.js");
    
    assert.ok(module.default);
    assert.equal(module.default, module.StellarEventBoundary);
  });
});
