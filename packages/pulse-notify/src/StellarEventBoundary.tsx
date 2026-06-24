"use client";

import { useEffect, useState, ReactNode } from "react";

/**
 * StellarEventBoundary
 *
 * A client-side boundary wrapper for components that use EventSource
 * or other browser-only APIs.
 *
 * ## Why this exists
 * EventSource is not available in SSR environments. Wrapping consumer
 * components in StellarEventBoundary ensures they only render after
 * hydration, preventing SSR runtime errors.
 *
 * ## Usage
 * ```tsx
 * import { StellarEventBoundary } from "@orbital/pulse-notify";
 *
 * // Wrap any component that uses pulse-notify hooks:
 * <StellarEventBoundary fallback={<LoadingSkeleton />}>
 *   <MyNotificationComponent />
 * </StellarEventBoundary>
 * ```
 *
 * ## SSR Behavior
 * - During SSR: renders `fallback` (defaults to null)
 * - After hydration: renders `children`
 *
 * ## Wrong usage (will throw in SSR):
 * ```tsx
 * // ❌ Don't do this — useStellarEvent is client-only
 * function Page() {
 *   const events = useStellarEvent("https://api.example.com", "GABC");
 *   return <div>{events.event?.type}</div>;
 * }
 *
 * // ✅ Do this instead
 * function Page() {
 *   return (
 *     <StellarEventBoundary>
 *       <EventConsumer />
 *     </StellarEventBoundary>
 *   );
 * }
 * ```
 */

export interface StellarEventBoundaryProps {
  /** React nodes to render after hydration */
  children: ReactNode;
  /** React nodes to render during SSR and before hydration (defaults to null) */
  fallback?: ReactNode;
}

/**
 * StellarEventBoundary component
 *
 * Ensures client-only components that depend on EventSource or other
 * browser APIs only render after hydration, preventing SSR errors.
 *
 * @param props - Component props
 * @param props.children - Content to render after hydration
 * @param props.fallback - Content to render during SSR (defaults to null)
 * @returns React element
 */
export function StellarEventBoundary({
  children,
  fallback = null,
}: StellarEventBoundaryProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export default StellarEventBoundary;
