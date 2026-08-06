import { spawnSync } from "node:child_process";
import type { Reminder } from "./reminder.ts";

export const DIALOG_TIMEOUT_SECONDS = 604800;

export const BUTTON_LATER = "Remind me later";
export const BUTTON_ACKNOWLEDGE = "I have handled it";
export const BUTTON_OPEN = "Open";

export type DialogAction = "open" | "later" | "acknowledge" | "none";

export function escapeAppleScript(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function dialogButtons(reminder: Reminder): string[] {
  const buttons = [BUTTON_LATER, BUTTON_ACKNOWLEDGE];
  if (reminder.page !== null) {
    buttons.push(BUTTON_OPEN);
  }
  return buttons;
}

export function defaultButton(reminder: Reminder): string {
  let button = BUTTON_ACKNOWLEDGE;
  if (reminder.page !== null) {
    button = BUTTON_OPEN;
  }
  return button;
}

export function buildDialogScript(reminder: Reminder): string {
  const buttons = dialogButtons(reminder)
    .map((button) => `"${escapeAppleScript(button)}"`)
    .join(", ");
  const title = escapeAppleScript(reminder.title);
  const message = escapeAppleScript(reminder.message);
  const chosen = escapeAppleScript(defaultButton(reminder));
  return [
    'tell application "System Events"',
    "  activate",
    `  with timeout of ${DIALOG_TIMEOUT_SECONDS} seconds`,
    `    set answer to button returned of (display dialog "${message}" with title "${title}" buttons {${buttons}} default button "${chosen}" with icon caution)`,
    "  end timeout",
    "end tell",
    "return answer",
  ].join("\n");
}

export function buildNotificationScript(reminder: Reminder): string {
  const title = escapeAppleScript(reminder.title);
  const message = escapeAppleScript(reminder.message.split("\n")[0]!);
  return `display notification "${message}" with title "${title}" sound name "Glass"`;
}

export function actionForButton(button: string): DialogAction {
  let action: DialogAction = "none";
  if (button === BUTTON_OPEN) {
    action = "open";
  } else if (button === BUTTON_ACKNOWLEDGE) {
    action = "acknowledge";
  } else if (button === BUTTON_LATER) {
    action = "later";
  }
  return action;
}

export function runOsascript(script: string): string {
  const result = spawnSync("/usr/bin/osascript", ["-"], {
    input: script,
    encoding: "utf8",
  });
  let output = "";
  if (typeof result.stdout === "string") {
    output = result.stdout.trim();
  }
  return output;
}

export function openPage(page: string): void {
  spawnSync("/usr/bin/open", [page], { stdio: "ignore" });
}

export function showNotification(reminder: Reminder): void {
  runOsascript(buildNotificationScript(reminder));
}

export function showDialog(reminder: Reminder): DialogAction {
  const button = runOsascript(buildDialogScript(reminder));
  return actionForButton(button);
}
