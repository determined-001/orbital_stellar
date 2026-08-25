import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orbital Next.js starter",
  description: "Live, typed Stellar events in the browser via React hooks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "48px 24px",
          background: "#0b0b0c",
          color: "#e8e8ea",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          lineHeight: 1.6,
        }}
      >
        <main style={{ maxWidth: 720, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
