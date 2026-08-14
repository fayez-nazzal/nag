import { spawnSync } from "node:child_process";
import type { Reminder } from "@nag/obligation/reminder.ts";

export const DIALOG_TIMEOUT_SECONDS = 3600;

export type OsascriptResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export function escapeAppleScript(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function dialogMessage(reminder: Reminder): string {
  let message = reminder.message;
  if (reminder.page !== null) {
    message = `${message}\n\nOpen: ${reminder.page}`;
  }
  return message;
}

export function buildDialogScript(reminder: Reminder): string {
  const title = escapeAppleScript(reminder.title);
  const message = escapeAppleScript(dialogMessage(reminder));
  return [
    'tell application "System Events"',
    "  activate",
    `  with timeout of ${DIALOG_TIMEOUT_SECONDS} seconds`,
    `    display dialog "${message}" with title "${title}" buttons {"OK"} default button "OK" with icon caution`,
    "  end timeout",
    "end tell",
  ].join("\n");
}

export function runOsascript(script: string): OsascriptResult {
  const result = spawnSync("/usr/bin/osascript", ["-"], {
    input: script,
    encoding: "utf8",
  });
  let status = 1;
  if (typeof result.status === "number") {
    status = result.status;
  }
  let stdout = "";
  if (typeof result.stdout === "string") {
    stdout = result.stdout.trim();
  }
  let stderr = "";
  if (typeof result.stderr === "string") {
    stderr = result.stderr.trim();
  }
  return { status, stdout, stderr };
}

export function showDialog(reminder: Reminder): OsascriptResult {
  return runOsascript(buildDialogScript(reminder));
}
