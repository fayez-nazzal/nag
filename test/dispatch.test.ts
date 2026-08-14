import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialogAction } from "../src/deliver.ts";
import {
  acquireLock,
  applyAction,
  dispatch,
  fireReminder,
  isLocked,
  isProcessAlive,
  releaseLock,
  type Deliverer,
} from "../src/dispatch.ts";
import { ALL_CHANNELS, type Reminder } from "../src/reminder.ts";
import { lockPath, loadReminder, reminderPath, saveReminder } from "../src/store.ts";

let home = "";
let previousHome: string | undefined;

type Recorder = Deliverer & {
  dialogs: string[];
  notifications: string[];
  opened: string[];
};

function makeRecorder(answer: DialogAction = "later"): Recorder {
  const recorder: Recorder = {
    dialogs: [],
    notifications: [],
    opened: [],
    showDialog: (reminder) => {
      recorder.dialogs.push(reminder.id);
      return answer;
    },
    showNotification: (reminder) => {
      recorder.notifications.push(reminder.id);
    },
    openPage: (page) => {
      recorder.opened.push(page);
    },
  };
  return recorder;
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "sample",
    title: "Sample",
    message: "Body",
    page: null,
    channels: [...ALL_CHANNELS],
    everySeconds: 600,
    startAt: null,
    lastFiredAt: null,
    acknowledgedAt: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  previousHome = process.env.NAG_HOME;
  home = mkdtempSync(join(tmpdir(), "nag-dispatch-"));
  process.env.NAG_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) {
    delete process.env.NAG_HOME;
  } else {
    process.env.NAG_HOME = previousHome;
  }
});

describe("locks", () => {
  test("a lock held by this live process reads as locked", () => {
    acquireLock("sample");
    expect(isLocked("sample")).toBe(true);
    releaseLock("sample");
    expect(isLocked("sample")).toBe(false);
  });

  test("a stale lock from a dead process is cleared, not honoured", () => {
    acquireLock("sample");
    writeFileSync(lockPath("sample"), "999999");
    expect(isLocked("sample")).toBe(false);
    expect(isLocked("sample")).toBe(false);
  });

  test("this process is alive and a nonsense pid is not", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999999)).toBe(false);
  });
});

describe("fireReminder", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("records the fire time so a crash cannot loop hot", () => {
    const reminder = makeReminder();
    saveReminder(reminder);
    fireReminder(reminder, now, makeRecorder());
    expect(loadReminder("sample")?.lastFiredAt).toBe(now.toISOString());
  });

  test("uses only the channels the reminder asked for", () => {
    const recorder = makeRecorder();
    const reminder = makeReminder({ channels: ["dialog"] });
    saveReminder(reminder);
    fireReminder(reminder, now, recorder);
    expect(recorder.dialogs).toEqual(["sample"]);
    expect(recorder.notifications).toEqual([]);
  });

  test("skips the dialog when the reminder has no dialog channel", () => {
    const recorder = makeRecorder();
    const reminder = makeReminder({ channels: ["terminal"] });
    saveReminder(reminder);
    expect(fireReminder(reminder, now, recorder)).toBe("none");
    expect(recorder.dialogs).toEqual([]);
  });

  test("acknowledging from the dialog stops future fires", () => {
    const reminder = makeReminder();
    saveReminder(reminder);
    fireReminder(reminder, now, makeRecorder("acknowledge"));
    expect(loadReminder("sample")?.acknowledgedAt).toBe(now.toISOString());
  });

  test("opening from the dialog opens the page and leaves it unacknowledged", () => {
    const recorder = makeRecorder("open");
    const reminder = makeReminder({ page: "/tmp/page.html" });
    saveReminder(reminder);
    fireReminder(reminder, now, recorder);
    expect(recorder.opened).toEqual(["/tmp/page.html"]);
    expect(loadReminder("sample")?.acknowledgedAt).toBeNull();
  });
});

describe("applyAction", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("does nothing on later", () => {
    const recorder = makeRecorder();
    const reminder = makeReminder();
    saveReminder(reminder);
    applyAction(reminder, "later", now, recorder);
    expect(reminder.acknowledgedAt).toBeNull();
    expect(recorder.opened).toEqual([]);
  });

  test("does not try to open when there is no page", () => {
    const recorder = makeRecorder();
    applyAction(makeReminder(), "open", now, recorder);
    expect(recorder.opened).toEqual([]);
  });
});

describe("dispatch", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("fires only what is due", () => {
    const recorder = makeRecorder();
    saveReminder(makeReminder({ id: "due" }));
    saveReminder(makeReminder({ id: "held", startAt: "2026-08-06T18:00:00.000Z" }));
    saveReminder(makeReminder({ id: "done", acknowledgedAt: "2026-08-06T01:00:00.000Z" }));
    const result = dispatch(now, recorder);
    expect(result.fired).toEqual(["due"]);
    expect(recorder.dialogs).toEqual(["due"]);
  });

  test("skips a reminder whose dialog is already showing", () => {
    saveReminder(makeReminder({ id: "busy" }));
    acquireLock("busy");
    const result = dispatch(now, makeRecorder());
    expect(result.fired).toEqual([]);
    expect(result.locked).toEqual(["busy"]);
    releaseLock("busy");
  });

  test("releases the lock after firing so the next round can fire again", () => {
    saveReminder(makeReminder({ id: "sample" }));
    dispatch(now, makeRecorder());
    expect(isLocked("sample")).toBe(false);
  });

  test("fires nothing when the store is empty", () => {
    expect(dispatch(now, makeRecorder()).fired).toEqual([]);
  });
});

describe("dispatch tolerates a bad store file", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("fires the good reminders and ignores the unreadable one instead of throwing", () => {
    saveReminder(makeReminder({ id: "due" }));
    writeFileSync(reminderPath("broken"), "not json");
    const result = dispatch(now, makeRecorder());
    expect(result.fired).toEqual(["due"]);
  });
});
