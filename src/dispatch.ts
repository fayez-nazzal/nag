import { showDialog } from "./deliver.ts";
import type { Reminder } from "./reminder.ts";
import { isDue } from "./reminder.ts";
import { appendLog, ensureDirs, listReminders, saveReminder } from "./store.ts";

export type Deliverer = {
  showDialog: (reminder: Reminder) => void;
};

export type DispatchResult = {
  fired: string[];
};

export const systemDeliverer: Deliverer = {
  showDialog,
};

export function fireReminder(reminder: Reminder, now: Date, deliverer: Deliverer = systemDeliverer): void {
  reminder.lastFiredAt = now.toISOString();
  saveReminder(reminder);
  if (reminder.channels.includes("dialog")) {
    deliverer.showDialog(reminder);
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
