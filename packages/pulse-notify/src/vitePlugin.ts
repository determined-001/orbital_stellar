/**
 * pulseNotifyVitePlugin
 * ---------------------
 * Stubs the browser-only `EventSource` global during Vite SSR so that
 * importing `@orbital/pulse-notify` in a server-side render context does not
 * throw "EventSource is not defined".
 *
 * ### Usage (vite.config.ts)
 * ```ts
 * import { pulseNotifyVitePlugin } from "@orbital/pulse-notify/vitePlugin";
 *
 * export default defineConfig({
 *   plugins: [pulseNotifyVitePlugin()],
 *   ssr: { noExternal: ["@orbital/pulse-notify"] },
 * });
 * ```
 *
 * The stub is injected only when Vite is running in SSR mode
 * (`options.isSsrBuild` or the `ssr` transform flag). It is a no-op in the
 * browser bundle.
 */

/** Minimal EventSource stub injected at the top of the SSR entry. */
const EVENT_SOURCE_STUB = `
if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = class EventSourceStub {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    constructor() {
      this.readyState = EventSourceStub.CLOSED;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
    }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return false; }
    close() {}
  };
}
`;

export interface PulseNotifyVitePlugin {
  name: string;
  // Vite plugin hook types kept loose to avoid requiring "vite" as a dep.
  config?: (config: Record<string, unknown>, env: { isSsrBuild?: boolean }) => void;
  transformIndexHtml?: never;
  transform?: (code: string, id: string, options?: { ssr?: boolean }) => { code: string } | null;
  generateBundle?: never;
}

/**
 * Returns a Vite plugin that prepends an `EventSource` no-op stub to every
 * SSR-transformed module that references `EventSource`, preventing
 * "EventSource is not defined" crashes at module-load time.
 */
export function pulseNotifyVitePlugin(): PulseNotifyVitePlugin {
  return {
    name: "pulse-notify:ssr-event-source-shim",

    transform(code: string, id: string, options?: { ssr?: boolean }) {
      // Only run during SSR transforms and only when the module uses EventSource.
      if (!options?.ssr) return null;
      if (!code.includes("EventSource")) return null;

      return { code: EVENT_SOURCE_STUB + code };
    },
  };
}
