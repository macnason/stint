// A Server Component: imports the server-safe schema subpath, resolves the
// current month on the server, and renders the exported client component
// without `transpilePackages`.
import { Stint } from "@macnason/stint";
import {
  normalizeStintConfig,
  type MonthString,
  type StintConfig,
} from "@macnason/stint/schema";

/** Clearly fictional demo career data — no real person is described. */
const fixtureConfig: StintConfig = {
  schemaVersion: 1,
  entries: [
    {
      id: "tidepool",
      company: "Tidepool Systems",
      location: "Fremantle, Australia",
      start: "2019-03",
      end: "2021-08",
      roles: [
        { id: "tidepool-designer", title: "Product Designer", start: "2019-03" },
      ],
    },
    {
      id: "lanternworks",
      company: "Lanternworks",
      location: "Wellington, New Zealand",
      start: "2021-09",
      end: null,
      roles: [{ id: "lantern-lead", title: "Design Lead", start: "2021-09" }],
    },
  ],
};

export default function Page() {
  // Server-side schema use: validate with a server-resolved seed. The page
  // stays statically prerenderable so the build output itself proves SSR.
  const now = new Date();
  const initialMonth =
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}` as MonthString;
  const normalized = normalizeStintConfig(fixtureConfig, {
    referenceMonth: initialMonth,
  });
  if (normalized.errors.length > 0) {
    throw new Error("fixture data failed validation");
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>Stint — packed Next fixture</h1>
      <p data-entry-count={normalized.config?.entries.length}>
        {normalized.config?.entries.length} fictional entries validated on the
        server.
      </p>
      <Stint
        data={fixtureConfig}
        currentMonth={{ mode: "live", initialMonth, timeZone: "UTC" }}
        orientation="responsive"
      />
    </main>
  );
}
