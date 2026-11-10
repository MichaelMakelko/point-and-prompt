import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const FLAGS = ["--dangerously-load-development-channels", "--channels"];

/** Command line of the process that spawned this server (Claude Code). */
export async function parentCommandLine(pid = process.ppid): Promise<string> {
  if (process.platform === "win32") {
    const { stdout } = await exec("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]);
    return stdout.trim();
  }
  if (process.platform === "linux") {
    return (await readFile(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim();
  }
  const { stdout } = await exec("ps", ["-o", "command=", "-p", String(pid)]);
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
