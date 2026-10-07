# Document fixtures

All names and histories here are synthetic. No personal LinkedIn data is included.

- `profile.pdf`: selectable text in LinkedIn's company → role → date order, plus
  an Education section that must be excluded.
- `scanned-profile.pdf`: image-only rendering of that PDF, to exercise actual
  PDF rasterization and OCR rather than a mocked recognizer.
- `grouped-profile.png`: anonymized grouped promotions with locations, skill
  metadata and same-month role transitions.
- `logo-profile.png`: a 2× screenshot with logos that OCR reads as text ("SIG.",
  "mm", three dots), a grouped employer whose location has no comma, and an
  employer with no employment type.
- `profile.png`: a clear screenshot in LinkedIn's role → company → date order.

Expected history: Earlier Studio / Designer (Jan 2020–Dec 2021), followed by
Acme Studio / Senior Designer (Jan 2022–Present). Canonical finished months are
exclusive, so Earlier Studio ends at `2022-01`.

The PDF uses Helvetica. The screenshot uses Liberation Sans. Images were created
locally with ImageMagick; the scanned PDF was rasterized with Poppler and embedded
as a Flate-compressed RGB image. These are fixture-authoring tools only: neither
is needed to run tests or use the CLI. Tests load the shipped WebAssembly engines
and English model with fetch disabled; they do not use system OCR.
