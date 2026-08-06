import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { formatDuration } from "./reminder.ts";
import { ensureDirs, logsDir } from "./store.ts";

export const AGENT_LABEL = "local.nag";

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
  return kept.join("\n");
}

function domainTarget(): string {
  return `gui/${userInfo().uid}/${AGENT_LABEL}`;
}

function updateZshrc(transform: (content: string) => string): boolean {
  const path = zshrcPath();
  let content = "";
  if (existsSync(path)) {
    content = readFileSync(path, "utf8");
  }
  const updated = transform(content);
  const changed = updated !== content;
  if (changed) {
    writeFileSync(path, updated);
  }
  return changed;
}

export function runInstall(intervalSeconds: number): string[] {
  ensureDirs();
  const cliPath = join(import.meta.dir, "cli.ts");
  const options = defaultPlistOptions(process.execPath, cliPath, intervalSeconds);
  const path = agentPlistPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildPlist(options));
  spawnSync("/bin/launchctl", ["bootout", domainTarget()], { stdio: "ignore" });
  const loaded = spawnSync("/bin/launchctl", ["bootstrap", `gui/${userInfo().uid}`, path], { encoding: "utf8" });
  const notes = [`agent written to ${path}`];
  if (loaded.status === 0) {
    notes.push(`agent loaded, dispatcher wakes every ${formatDuration(intervalSeconds)}`);
  } else {
    notes.push(`agent could not be loaded: ${String(loaded.stderr).trim()}`);
  }
  if (updateZshrc(addZshrcBlock)) {
    notes.push(`banner line added to ${zshrcPath()}`);
  } else {
    notes.push(`banner line already present in ${zshrcPath()}`);
  }
  return notes;
}

export function runUninstall(): string[] {
  const path = agentPlistPath();
  const notes: string[] = [];
  spawnSync("/bin/launchctl", ["bootout", domainTarget()], { stdio: "ignore" });
  if (existsSync(path)) {
    rmSync(path);
    notes.push(`agent unloaded and ${path} removed`);
  } else {
    notes.push("agent was not installed");
  }
  if (updateZshrc(removeZshrcBlock)) {
    notes.push(`banner line removed from ${zshrcPath()}`);
  } else {
    notes.push(`no banner line found in ${zshrcPath()}`);
  }
  return notes;
}
