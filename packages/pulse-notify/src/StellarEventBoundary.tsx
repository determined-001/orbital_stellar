"use client";
import { useEffect, useState, ReactElement, ReactNode } from "react";

export type StellarEventBoundaryProps = {
  /**
   * Fallback UI rendered during server-side rendering or before hydration.
   * Defaults to null.
   */
  fallback?: ReactNode;
  /**
   * Client‑only children to render after component mounts.
   */
  children?: ReactNode;
};

/**
 * StellarEventBoundary renders a fallback on the server and switches to rendering
 * its children once the component has mounted on the client. This avoids SSR
 * hydration mismatches for components that rely on browser‑only APIs such as
 * EventSource or WebSocket.
 */
export function StellarEventBoundary({
  fallback = null,
  children,
}: StellarEventBoundaryProps): ReactElement {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return isMounted ? <>{children}</> : <>{fallback}</>;
}
