import { spawn } from "node:child_process";
import type { Reminder } from "./reminder.ts";

export const DIALOG_TIMEOUT_SECONDS = 3600;

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

export function runOsascript(script: string): void {
  const child = spawn("/usr/bin/osascript", ["-"], {
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
  });
  child.stdin.end(script);
  child.unref();
}

export function showDialog(reminder: Reminder): void {
  runOsascript(buildDialogScript(reminder));
}
