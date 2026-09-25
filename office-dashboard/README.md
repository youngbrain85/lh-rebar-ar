# Office Dashboard — LH Rebar AR

The office console of the LH Rebar AR system (see the repository README). It is a Next.js app deployed on Vercel.

## Features

- **Site management** — site table from the project backend with live badges, a 3D model drawer and a three.js USDZ
  viewer.
- **Live collaboration** — watch the field app's AR screen at its native aspect ratio, talk back, and annotate by
  clicking (2D pointer pings and world-locked 3D memo pins, sent over the LiveKit data channel).
- **As-built analysis** — upload an as-built scan (rebar centerlines), register it to the design model in the
  browser (PCA + ICP), match it bar by bar, classify bars as missing, out of tolerance or not in the drawings, and
  show a five-level contour map of spacing or position deviation on the wall.

## API routes

| Route | Purpose |
|---|---|
| `/api/token` | Issues LiveKit access tokens on the server; the secret never reaches the client |
| `/api/sites`, `/api/models`, `/api/model` | Proxies to the backend for the site list, model list and USDZ stream |
| `/api/live` | Lists active LiveKit rooms (for the live badges) |
| `/api/scan-upload`, `/api/scans`, `/api/scan` | Upload, list and resolve as-built scans (Vercel Blob) |
| `/api/analysis-result` | Save and load analysis results |

## Running

```bash
npm install
npm run dev              # → http://localhost:3000
npm run build            # catches type errors before deployment
npx vercel deploy --prod --yes
```

The LiveKit settings and the Vercel Blob token go in `.env.local`, which is not committed.
