# Onboarding walkthrough

A recording harness that runs the real CLI from locally packed PR builds in a fresh temporary React/Vite project. The controls are demo tooling, not a shipped Stint onboarding UI. All career data is synthetic.

From the repository root, with Node 22 or later:

```sh
npm ci
npm run build
node scripts/onboarding-demo/server.mjs
```

Open `http://127.0.0.1:4187` and advance through installation, project discovery, LinkedIn URL capability discovery, local screenshot OCR, review, apply, and the interactive React timeline. Package installation requires npm registry access; document extraction runs locally using the bundled OCR assets. The URL step does not access LinkedIn or imply that a browser is authenticated.

Each server start creates a fresh project under the system temporary directory and prints its path. Restart to repeat the walkthrough; remove that temporary directory when finished. Actions are sequential and shared between viewers. The server accepts only its fixed demo actions and binds to IPv4 loopback. For a remote preview, use your private forwarding setup and add its exact hostname to the Vite `allowedHosts` setting in `server.mjs`.

To record a fresh walkthrough, install Chromium and FFmpeg on the recording host, start a new demo server, then run:

```sh
CHROME_PATH=/usr/bin/chromium node scripts/onboarding-demo/record.mjs /tmp/stint-onboarding.mp4
```

`DEMO_URL` can override the recording URL. The recorder exercises every real command, builds the generated consumer project, moves through the timeline with keyboard and pointer input, and fails on browser exceptions. It also saves start and completion screenshots beside the MP4. No recording tools or demo dependencies are added to the published package.

GitHub CLI 2.99 and later can upload the MP4 directly into a pull request body:

```sh
gh pr edit PR_NUMBER --attach /tmp/stint-onboarding.mp4
```

GitHub renders the attachment as a native video player. The interactive application itself runs in the walkthrough server; the embedded video is a recording of those interactions.
