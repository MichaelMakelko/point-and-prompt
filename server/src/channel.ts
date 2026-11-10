import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const FLAGS = ["--dangerously-load-development-channels", "--channels"];
/** The time limit keeps a hanging WMI service or ps from leaving the server waiting forever with no port and no log line. */
const EXEC_OPTIONS = { timeout: 10_000, windowsHide: true };

/**
 * Full path on purpose. For a bare file name Node looks in the current folder first on Windows, and that
 * folder is the user's project: a powershell.exe lying in a cloned repository would be started instead.
 */
function powershellPath(): string {
  return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Command line of the process that spawned this server (Claude Code). */
export async function parentCommandLine(pid = process.ppid): Promise<string> {
  // The id becomes part of a command and of a path below.
  if (!Number.isInteger(pid) || pid < 0) throw new Error(`Ungültige Prozess-ID: ${pid}`);

  if (process.platform === "win32") {
    // The [wmi] object path is about 130 ms faster here than Get-CimInstance, which loads a module first.
    const { stdout } = await exec(
      powershellPath(),
      ["-NoProfile", "-NonInteractive", "-Command", `([wmi]"Win32_Process.Handle='${pid}'").CommandLine`],
      EXEC_OPTIONS,
    );
    return stdout.trim();
  }
  if (process.platform === "linux") {
    return (await readFile(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim();
  }
  // -ww: never cut the command line to a terminal width, the flag may stand at its end.
  const { stdout } = await exec("ps", ["-ww", "-o", "command=", "-p", String(pid)], EXEC_OPTIONS);
  return stdout.trim();
}

/**
 * True if the command line opts this server in as a channel, e.g.
 * `--dangerously-load-development-channels server:point-and-prompt` or `--channels=server:a,server:b`.
 * Claude Code drops channel events silently otherwise, so the server must not claim a port then.
 */
export function hasChannelFlag(commandLine: string, serverName: string): boolean {
  const tokens = commandLine.split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ""));
  const wanted = `server:${serverName}`;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const flag = FLAGS.find((f) => token === f || token.startsWith(`${f}=`));
    if (!flag) continue;
    const values = token === flag ? [] : [token.slice(flag.length + 1)];
    for (let j = i + 1; j < tokens.length && !tokens[j]!.startsWith("-"); j++) values.push(tokens[j]!);
    if (values.flatMap((v) => v.split(",")).includes(wanted)) return true;
  }
  return false;
}
