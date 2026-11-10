# Contributing

Thanks for helping. Bug reports, ideas and pull requests are welcome.

## Before you start

- For a bug or a small fix, open an issue or a pull request directly.
- For a larger change, open an issue first so we can agree on the direction before you write code.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Setup

You need Node.js 22.6 or newer for development (the tests run TypeScript directly) and a Chromium browser.

```bash
git clone https://github.com/MichaelMakelko/point-and-prompt.git
cd point-and-prompt/server
npm install
npm run typecheck
npm test
npm run build
```

Load `extension/` as an unpacked extension on `chrome://extensions`. After changing extension files, click the reload button there and reload your localhost page. After changing server files, run `npm run build` and restart Claude Code.

## Layout

| Path | What it is |
|---|---|
| `extension/content.js` | Overlay on the page: element picker, box selection, popover, dictation |
| `extension/background.js` | Service worker: screenshot, session discovery, sending to the server |
| `server/src/http.ts` | Local HTTP endpoint with the origin check |
| `server/src/payload.ts` | Validation of what the extension sends |
| `server/src/format.ts` | The message Claude reads, and the channel instructions |
| `server/src/channel.ts` | Detects whether the session was started with the channel flag |
| `server/src/index.ts` | MCP server, port selection, startup |

## Pull requests

- Keep a pull request to one topic.
- Add or adjust a test in `server/src/server.test.ts` when you change server behavior.
- The extension has no build step and no dependencies. Please keep it that way.
- CI must pass: type check, tests and build on Node 22 and 24.
- Changes to the origin check, payload validation or message format need a short note on the security effect.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
