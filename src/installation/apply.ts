import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { formatDuration } from "@nag/obligation/reminder.ts";
import { ensureDirs, logsDir, rootDir } from "@nag/ledger/records.ts";

export const AGENT_LABEL = "io.fayez.nag";

export const DEFAULT_DISPATCH_INTERVAL_SECONDS = 60;

export const ZSHRC_BEGIN = "# >>> nag banner >>>";
export const ZSHRC_END = "# <<< nag banner <<<";
export const ZSHRC_COMMAND = "command -v nag >/dev/null 2>&1 && nag banner";

export type PlistOptions = {
  label: string;
  bunPath: string;
  cliPath: string;
  intervalSeconds: number;
  outLog: string;
  errLog: string;
};

export function agentPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${AGENT_LABEL}.plist`);
}

export function zshrcPath(): string {
  return join(homedir(), ".zshrc");
}

export function defaultPlistOptions(bunPath: string, cliPath: string, intervalSeconds: number): PlistOptions {
  return {
    label: AGENT_LABEL,
    bunPath,
    cliPath,
    intervalSeconds,
    outLog: join(logsDir(), "launchd.out.log"),
    errLog: join(logsDir(), "launchd.err.log"),
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildPlist(options: PlistOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.bunPath)}</string>
    <string>${escapeXml(options.cliPath)}</string>
    <string>dispatch</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${options.intervalSeconds}</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(join(homedir(), ".bun", "bin"))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.outLog)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.errLog)}</string>
</dict>
</plist>
`;
}

export function buildZshrcBlock(): string {
  return [ZSHRC_BEGIN, ZSHRC_COMMAND, ZSHRC_END].join("\n");
}

export function hasZshrcBlock(content: string): boolean {
  return content.includes(ZSHRC_BEGIN);
}

export function addZshrcBlock(content: string): string {
  let updated = content;
  if (!hasZshrcBlock(content)) {
    let separator = "\n\n";
    if (content.endsWith("\n")) {
      separator = "\n";
    }
    if (content.length === 0) {
      separator = "";
    }
    updated = `${content}${separator}${buildZshrcBlock()}\n`;
  }
  return updated;
}

export function removeZshrcBlock(content: string): string {
  let result = content;
  const beginIndex = content.indexOf(ZSHRC_BEGIN);
  if (beginIndex !== -1) {
    const endIndex = content.indexOf(ZSHRC_END, beginIndex);
    if (endIndex !== -1) {
      const lines = content.split("\n");
      const kept: string[] = [];
      let inside = false;
      for (const line of lines) {
        if (line.trim() === ZSHRC_BEGIN) {
          inside = true;
        } else if (line.trim() === ZSHRC_END) {
          inside = false;
        } else if (!inside) {
          kept.push(line);
        }
      }
      result = kept.join("\n");
    }
  }
  return result;
}

export type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (bin: string, args: string[]) => CommandResult;

export const systemCommandRunner: CommandRunner = (bin, args) => {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  let status = 1;
  if (typeof result.status === "number") {
    status = result.status;
  }
  let stdout = "";
  if (typeof result.stdout === "string") {
    stdout = result.stdout;
  }
  let stderr = "";
  if (typeof result.stderr === "string") {
    stderr = result.stderr;
  }
  return { status, stdout, stderr };
};

function domainTarget(): string {
  return `gui/${userInfo().uid}/${AGENT_LABEL}`;
}

function updateZshrc(transform: (content: string) => string, rcPath: string): boolean {
  let content = "";
  if (existsSync(rcPath)) {
    content = readFileSync(rcPath, "utf8");
  }
  const updated = transform(content);
  const changed = updated !== content;
  if (changed) {
    writeFileSync(rcPath, updated);
  }
  return changed;
}

export function runInstall(
  intervalSeconds: number,
  rcPath: string = zshrcPath(),
  plistPath: string = agentPlistPath(),
  runner: CommandRunner = systemCommandRunner,
): string[] {
  ensureDirs();
  const legacyLocksDir = join(rootDir(), "locks");
  if (existsSync(legacyLocksDir)) {
    rmSync(legacyLocksDir, { recursive: true, force: true });
  }
  const cliPath = join(import.meta.dir, "..", "cli.ts");
  const options = defaultPlistOptions(process.execPath, cliPath, intervalSeconds);
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, buildPlist(options));
  runner("/bin/launchctl", ["bootout", domainTarget()]);
  const loaded = runner("/bin/launchctl", ["bootstrap", `gui/${userInfo().uid}`, plistPath]);
  if (loaded.status !== 0) {
    throw new Error(`agent could not be loaded: ${loaded.stderr.trim()}`);
  }
  const notes = [`agent written to ${plistPath}`];
  notes.push(`agent loaded, dispatcher wakes every ${formatDuration(intervalSeconds)}`);
  if (updateZshrc(addZshrcBlock, rcPath)) {
    notes.push(`banner line added to ${rcPath}`);
  } else {
    notes.push(`banner line already present in ${rcPath}`);
  }
  return notes;
}

export function runUninstall(
  rcPath: string = zshrcPath(),
  plistPath: string = agentPlistPath(),
  runner: CommandRunner = systemCommandRunner,
): string[] {
  const notes: string[] = [];
  runner("/bin/launchctl", ["bootout", domainTarget()]);
  if (existsSync(plistPath)) {
    rmSync(plistPath);
    notes.push(`agent unloaded and ${plistPath} removed`);
  } else {
    notes.push("agent was not installed");
  }
  if (updateZshrc(removeZshrcBlock, rcPath)) {
    notes.push(`banner line removed from ${rcPath}`);
  } else {
    notes.push(`no banner line found in ${rcPath}`);
  }
  return notes;
}
