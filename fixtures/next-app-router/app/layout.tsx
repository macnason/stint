import type { ReactNode } from "react";
import "@macnason/stint/styles.css";
import "@macnason/stint/presets.css";

export const metadata = {
  title: "Stint fixture — Next App Router",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* Contrasting background: overflow masks must stay transparent. */}
      <body style={{ background: "#123047", color: "#f2ede4" }}>{children}</body>
    </html>
  );
}
