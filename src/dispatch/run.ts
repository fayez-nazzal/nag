import { showDialog, type OsascriptResult } from "@nag/alert/screen.ts";
import type { Reminder } from "@nag/obligation/reminder.ts";
import { isDue } from "@nag/obligation/reminder.ts";
import { appendLog, ensureDirs, listReminders, loadReminder, saveReminder } from "@nag/ledger/records.ts";

export type Deliverer = {
  showDialog: (reminder: Reminder) => OsascriptResult;
};

export type DispatchResult = {
  fired: string[];
};

export const systemDeliverer: Deliverer = {
  showDialog,
};

function applyDeliveryOutcome(reminder: Reminder, outcome: OsascriptResult, now: Date): void {
  let deliveredAt: string | null = null;
  let deliveryError: string | null = null;
  if (outcome.status === 0) {
    deliveredAt = now.toISOString();
  } else {
    let error = outcome.stderr;
    if (error.length === 0) {
      error = `osascript exited with status ${outcome.status}`;
    }
    deliveryError = error;
  }
  reminder.lastDeliveredAt = deliveredAt;
  reminder.lastDeliveryError = deliveryError;
}

export function fireReminder(reminder: Reminder, now: Date, deliverer: Deliverer = systemDeliverer): void {
  reminder.lastFiredAt = now.toISOString();
  saveReminder(reminder);
  if (reminder.channels.includes("dialog")) {
    const outcome = deliverer.showDialog(reminder);
    applyDeliveryOutcome(reminder, outcome, now);
    if (loadReminder(reminder.id) !== null) {
      saveReminder(reminder);
    }
  }
}

export function dispatch(now: Date, deliverer: Deliverer = systemDeliverer): DispatchResult {
  ensureDirs();
  const result: DispatchResult = { fired: [] };
  for (const reminder of listReminders().reminders) {
    if (isDue(reminder, now)) {
      fireReminder(reminder, now, deliverer);
      result.fired.push(reminder.id);
      appendLog(`fire ${reminder.id}`);
    }
  }
  return result;
}
