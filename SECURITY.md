# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub: [Report a vulnerability](https://github.com/MichaelMakelko/point-and-prompt/security/advisories/new).

Include what you found, how to reproduce it and which version or commit you tested. You can expect a first answer within 7 days. Once a fix is released, the advisory is published and you are credited if you want to be.

## Supported versions

Only the latest commit on `main` is supported.

## What counts as a vulnerability

point-and-prompt forwards text to a coding agent that can edit files and run commands, so these are in scope:

- A web page or another origin sending a prompt to the channel server without the user doing it in the overlay.
- A page making its own content appear as the user's request (breaking out of the fenced page content).
- The server accepting requests from outside `127.0.0.1` or from an origin other than the extension.
- Writing files outside the screenshot folder, or reading files through the server.

Out of scope:

- Another program running under your own user account talking to the server. It can already act as you.
- Page content that tries to instruct Claude from inside the fenced block. It is marked as data and Claude is told not to follow it, but no prompt-injection defense is complete. Use the overlay only on pages you trust.
