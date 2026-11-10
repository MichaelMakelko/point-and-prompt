# point-and-prompt

Point at your local dev page, say what should change, and the request lands in your running **Claude Code** session.

- **Element mode:** hover highlights an element, click selects it.
- **Box mode:** drag a rectangle over any area.
- A small popover opens next to the selection: type (or dictate) your request and press `Enter` (`Shift+Enter` for a new line).
- Claude receives your text, the page URL, a CSS selector, the visible text, trimmed HTML and a cropped screenshot, and starts working immediately.

It is built on [Claude Code channels](https://code.claude.com/docs/en/channels-reference) (research preview): a tiny MCP server pushes events into the session, and a Chrome extension provides the overlay.

```
Chrome extension (overlay, screenshot)  ──HTTP 127.0.0.1:7428–7447──▶  MCP channel server  ──stdio──▶  Claude Code session
```

Several sessions can run at once (e.g. three landing pages, each in its own Claude Code session). Every session takes the first free port from 7428 to 7447; the toolbox lists them by project folder and remembers per page (e.g. `localhost:3000`) which session it sends to.

## Requirements

- Claude Code with channels support, signed in with claude.ai or a Console API key (not Bedrock/Vertex/Foundry). Team/Enterprise orgs must enable channels in the admin settings.
- Node.js 20+
- Chrome or another Chromium browser (116+)

## Setup

```bash
git clone https://github.com/MichaelMakelko/point-and-prompt.git
cd point-and-prompt/server
npm install
npm run build
```

Register the channel server once for all projects:

```bash
claude mcp add --scope user point-and-prompt -- node /absolute/path/to/point-and-prompt/server/dist/index.js
```

Every Claude Code session now starts the server, but it only opens a port when the session was started with the channel flag. It checks this by reading Claude Code's command line, because Claude Code silently drops channel events from sessions without the flag. Set `PNP_SKIP_FLAG_CHECK=1` if that check fails in your setup (e.g. Claude Code started through a wrapper script).

During the research preview the flag is needed on every start; there is no setting for it. A shell shortcut saves typing:

```powershell
# PowerShell: add to $PROFILE
function claudep { claude --dangerously-load-development-channels server:point-and-prompt @args }
```

```bash
# bash/zsh: add to ~/.bashrc or ~/.zshrc
alias claudep='claude --dangerously-load-development-channels server:point-and-prompt'
```

Load the extension: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick the `extension/` folder.

## Use

1. Start Claude Code in your project folder with the channel enabled and confirm the startup dialog:

   ```bash
   claudep   # or: claude --dangerously-load-development-channels server:point-and-prompt
   ```

2. Start your dev server and open the page on `http://localhost:<port>` or `http://127.0.0.1:<port>`.
3. Press `Alt+Shift+P` (or click the extension icon). The toolbox bottom right shows a green dot and the project name when the session is connected. With several sessions, click the project name to pick one; the choice is remembered for this page.
4. Click an element, or press `B` and drag a box. `E` switches back to element mode, `Esc` cancels or turns the overlay off.
5. Type or dictate your request, `Enter` to send. The toolbox confirms which project received it.

## Security and privacy

- The server listens on `127.0.0.1` only and accepts requests only with the extension's origin (`chrome-extension://moeaooemoikililkakdldlamlgcebpll`, fixed by the `key` in `manifest.json`). Web pages cannot forge that header, so a random site cannot push prompts into your session.
- Page content is passed to Claude fenced as data, and the channel instructions tell Claude not to follow instructions found in it. Still: only use the overlay on pages you trust.
- Screenshots are saved to your OS temp folder (`<tmp>/point-and-prompt/`).
- Dictation uses Chrome's Web Speech API, which sends audio to Google for recognition. Don't use the mic button if that is a problem.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PNP_PORT` | `7428` | First port of the 20-port range. If you change it, also change `BASE_PORT` in `extension/background.js`. |
| `PNP_SKIP_FLAG_CHECK` | unset | `1` opens the port without checking for the channel flag. |
| `PNP_EXTENSION_ID` | fixed ID | Accept a different extension ID (e.g. if you remove `key` from the manifest). |

## Limitations

- Up to 20 sessions at the same time.
- One-way: the overlay confirms delivery, Claude answers in the terminal.
- Claude locates the code via visible text and selector; there is no framework-specific source mapping.

## Development

```bash
cd server
npm run typecheck
npm test
```

## Kurzanleitung (Deutsch)

1. `cd server && npm install && npm run build`
2. Einmalig für alle Projekte: `claude mcp add --scope user point-and-prompt -- node <Pfad>/server/dist/index.js`
   Kurzbefehl ins PowerShell-Profil (`notepad $PROFILE`): `function claudep { claude --dangerously-load-development-channels server:point-and-prompt @args }`
3. Chrome: `chrome://extensions` → Entwicklermodus → „Entpackte Erweiterung laden“ → Ordner `extension/`
4. Claude im Projektordner mit `claudep` starten. Mehrere Projekte gleichzeitig gehen; in der Toolbox auf den Projektnamen klicken, um die Session für die Seite zu wählen.
5. Dev-Seite auf localhost öffnen, `Alt+Shift+P`, Element anklicken oder mit `B` einen Kasten ziehen, Wunsch tippen oder diktieren, `Enter` (`Shift+Enter` für neue Zeile).

## License

MIT
