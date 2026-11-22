/**
 * Minimal process inspection used to prove ownership before stopping anything.
 * Nothing here terminates a process merely because it holds a port.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const windows = process.platform === "win32";
function powershell(command: string) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 },
  ).trim();
}
export function isAlive(pid: number | undefined) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
/** PID listening on a loopback TCP port, if any. */
export function listeningPid(port: number): number | undefined {
  try {
    const output = windows
      ? powershell(
          `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
        )
      : execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
          encoding: "utf8",
        }).trim();
    const pid = Number(output.split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}
/** Full executable path of a process, when the OS reports it. */
export function processPath(pid: number): string | undefined {
  try {
    const output = windows
      ? powershell(`(Get-Process -Id ${pid} -ErrorAction Stop).Path`)
      : execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
          encoding: "utf8",
        }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}
export function processCommandLine(pid: number): string | undefined {
  try {
    const output = windows
      ? powershell(
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop).CommandLine`,
        )
      : execFileSync("ps", ["-p", String(pid), "-o", "args="], {
          encoding: "utf8",
        }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}
export const samePath = (a: string, b: string) =>
  windows
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
/** Stop a process tree we started (Next.js spawns worker processes). */
export function stopTree(pid: number) {
  if (!isAlive(pid)) return;
  try {
    if (windows)
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid);
    } catch {
      /* already stopped */
    }
  }
}
/** PIDs of live Node processes whose command line contains `fragment`. */
export function nodeProcessesMatching(fragment: string): number[] {
  try {
    const output = windows
      ? powershell(
          `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${fragment.replace(/'/g, "")}*' } | ForEach-Object { $_.ProcessId }`,
        )
      : execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
          .split("\n")
          .filter((line) => line.includes(fragment))
          .map((line) => line.trim().split(/\s+/)[0])
          .join("\n");
    return output
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}
