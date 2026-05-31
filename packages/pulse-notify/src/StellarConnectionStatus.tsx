import { createElement, useEffect, useMemo, useState } from "react";
import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  ReactElement,
} from "react";

export type StellarConnectionStatusState =
  | "connecting"
  | "connected"
  | "error";

export type StellarConnectionStatusLabels = Partial<
  Record<StellarConnectionStatusState, string>
>;

export type StellarConnectionStatusProps = Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
> & {
  serverUrl: string;
  address: string;
  token?: string;
  labels?: StellarConnectionStatusLabels;
};

const DEFAULT_LABELS: Record<StellarConnectionStatusState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  error: "Retrying",
};

const STATUS_COLORS: Record<StellarConnectionStatusState, string> = {
  connecting: "#b45309",
  connected: "#047857",
  error: "#b91c1c",
};

function eventSourceUrl(serverUrl: string, address: string, token?: string) {
  const base = `${serverUrl}/events/${address}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export function StellarConnectionStatus({
  serverUrl,
  address,
  token,
  labels,
  className,
  style,
  "aria-label": ariaLabel,
  ...spanProps
}: StellarConnectionStatusProps): ReactElement {
  const [status, setStatus] =
    useState<StellarConnectionStatusState>("connecting");

  useEffect(() => {
    if (!serverUrl || !address) {
      setStatus("error");
      return;
    }

    setStatus("connecting");

    const source = new EventSource(eventSourceUrl(serverUrl, address, token));

    source.onopen = () => {
      setStatus("connected");
    };

    source.onerror = () => {
      setStatus("error");
    };

    return () => {
      source.close();
    };
  }, [serverUrl, address, token]);

  const label = labels?.[status] ?? DEFAULT_LABELS[status];
  const statusClassName = [
    "stellar-connection-status",
    `stellar-connection-status--${status}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const rootStyle = useMemo<CSSProperties>(
    () => ({
      alignItems: "center",
      background: `var(--stellar-connection-status-${status}-background, var(--stellar-connection-status-background, transparent))`,
      border: `var(--stellar-connection-status-${status}-border, var(--stellar-connection-status-border, 1px solid currentColor))`,
      borderRadius: "var(--stellar-connection-status-radius, 999px)",
      color: `var(--stellar-connection-status-${status}-color, var(--stellar-connection-status-color, ${STATUS_COLORS[status]}))`,
      display: "inline-flex",
      fontSize: "var(--stellar-connection-status-font-size, 0.875rem)",
      fontWeight: "var(--stellar-connection-status-font-weight, 500)",
      gap: "var(--stellar-connection-status-gap, 0.375rem)",
      lineHeight: "var(--stellar-connection-status-line-height, 1)",
      padding: "var(--stellar-connection-status-padding, 0.25rem 0.5rem)",
      ...style,
    }),
    [status, style]
  );

  const dotStyle = useMemo<CSSProperties>(
    () => ({
      background: `var(--stellar-connection-status-${status}-dot-color, var(--stellar-connection-status-dot-color, currentColor))`,
      borderRadius: "999px",
      display: "inline-block",
      height: "var(--stellar-connection-status-dot-size, 0.5rem)",
      width: "var(--stellar-connection-status-dot-size, 0.5rem)",
    }),
    [status]
  );

  return createElement(
    "span",
    {
      ...spanProps,
      "aria-label": ariaLabel ?? `Stellar connection ${label}`,
      "aria-live": spanProps["aria-live"] ?? "polite",
      className: statusClassName,
      "data-status": status,
      role: spanProps.role ?? "status",
      style: rootStyle,
    },
    createElement("span", {
      "aria-hidden": true,
      className: "stellar-connection-status__dot",
      style: dotStyle,
    }),
    createElement(
      "span",
      { className: "stellar-connection-status__label" },
      label
    )
  );
}
