import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { openPage, showDialog, showNotification, type DialogAction } from "./deliver.ts";
import type { Reminder } from "./reminder.ts";
import { isDue } from "./reminder.ts";
import { appendLog, ensureDirs, listReminders, lockPath, saveReminder } from "./store.ts";

export type Deliverer = {
  showDialog: (reminder: Reminder) => DialogAction;
  showNotification: (reminder: Reminder) => void;
  openPage: (page: string) => void;
};

export type DispatchResult = {
  fired: string[];
  locked: string[];
};

export const systemDeliverer: Deliverer = {
  showDialog,
  showNotification,
  openPage,
};

export function isProcessAlive(pid: number): boolean {
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  return alive;
}

export function isLocked(id: string): boolean {
  const path = lockPath(id);
  let locked = false;
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8").trim());
    locked = Number.isFinite(pid) && isProcessAlive(pid);
    if (!locked) {
      rmSync(path, { force: true });
    }
  }
  return locked;
}

export function acquireLock(id: string): void {
  ensureDirs();
  writeFileSync(lockPath(id), `${process.pid}`);
}

export function releaseLock(id: string): void {
  rmSync(lockPath(id), { force: true });
}

export function applyAction(
  reminder: Reminder,
  action: DialogAction,
  now: Date,
  deliverer: Deliverer = systemDeliverer,
): void {
  if (action === "open" && reminder.page !== null) {
    deliverer.openPage(reminder.page);
  }
  if (action === "acknowledge") {
    reminder.acknowledgedAt = now.toISOString();
    saveReminder(reminder);
  }
}

export function fireReminder(reminder: Reminder, now: Date, deliverer: Deliverer = systemDeliverer): DialogAction {
  reminder.lastFiredAt = now.toISOString();
  saveReminder(reminder);
  if (reminder.channels.includes("notification")) {
    deliverer.showNotification(reminder);
  }
  let action: DialogAction = "none";
  if (reminder.channels.includes("dialog")) {
    action = deliverer.showDialog(reminder);
  }
  applyAction(reminder, action, now, deliverer);
  return action;
}

export function dispatch(now: Date, deliverer: Deliverer = systemDeliverer): DispatchResult {
  ensureDirs();
  const result: DispatchResult = { fired: [], locked: [] };
  for (const reminder of listReminders().reminders) {
    if (isDue(reminder, now)) {
      if (isLocked(reminder.id)) {
        result.locked.push(reminder.id);
        appendLog(`skip ${reminder.id} already showing`);
      } else {
        acquireLock(reminder.id);
        try {
          const action = fireReminder(reminder, now, deliverer);
          result.fired.push(reminder.id);
          appendLog(`fire ${reminder.id} action=${action}`);
        } finally {
          releaseLock(reminder.id);
        }
      }
    }
  }
  return result;
}
