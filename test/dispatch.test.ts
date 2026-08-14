import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch, fireReminder, type Deliverer } from "../src/dispatch.ts";
import { ALL_CHANNELS, type Reminder } from "../src/reminder.ts";
import { loadReminder, reminderPath, removeReminder, saveReminder } from "../src/store.ts";

let home = "";
let previousHome: string | undefined;

type Recorder = Deliverer & {
  dialogs: string[];
};

function makeRecorder(): Recorder {
  const recorder: Recorder = {
    dialogs: [],
    showDialog: (reminder) => {
      recorder.dialogs.push(reminder.id);
      return { status: 0, stdout: "", stderr: "" };
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
    lastDeliveredAt: null,
    lastDeliveryError: null,
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

describe("fireReminder", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("records the fire time so a crash cannot loop hot", () => {
    const reminder = makeReminder();
    saveReminder(reminder);
    fireReminder(reminder, now, makeRecorder());
    expect(loadReminder("sample")?.lastFiredAt).toBe(now.toISOString());
  });

  test("shows the dialog only when the reminder has the dialog channel", () => {
    const recorder = makeRecorder();
    const reminder = makeReminder({ channels: ["dialog"] });
    saveReminder(reminder);
    fireReminder(reminder, now, recorder);
    expect(recorder.dialogs).toEqual(["sample"]);
  });

  test("skips the dialog when the reminder has no dialog channel", () => {
    const recorder = makeRecorder();
    const reminder = makeReminder({ channels: ["terminal"] });
    saveReminder(reminder);
    fireReminder(reminder, now, recorder);
    expect(recorder.dialogs).toEqual([]);
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

  test("fires nothing when the store is empty", () => {
    expect(dispatch(now, makeRecorder()).fired).toEqual([]);
  });

  test("returns while the dialog is still on screen instead of waiting on it", () => {
    let dialogStillOpen = false;
    const recorder: Deliverer = {
      showDialog: () => {
        dialogStillOpen = true;
        return { status: 0, stdout: "", stderr: "" };
      },
    };
    saveReminder(makeReminder({ id: "sample" }));
    const result = dispatch(now, recorder);
    expect(result.fired).toEqual(["sample"]);
    expect(dialogStillOpen).toBe(true);
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

describe("mid-dialog removal", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("a reminder removed while its dialog is open stays removed, it is never resurrected", () => {
    const reminder = makeReminder({ id: "sample" });
    saveReminder(reminder);
    const recorder: Deliverer = {
      showDialog: (target) => {
        removeReminder(target.id);
        return { status: 0, stdout: "", stderr: "" };
      },
    };
    fireReminder(reminder, now, recorder);
    expect(loadReminder("sample")).toBeNull();
  });
});

describe("delivery verification", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("a Screen stub returning a failed status reports delivery-failed and leaves lastDeliveredAt null", () => {
    const reminder = makeReminder({ id: "sample" });
    saveReminder(reminder);
    const failing: Deliverer = {
      showDialog: () => ({ status: 1, stdout: "", stderr: "user canceled" }),
    };
    fireReminder(reminder, now, failing);
    const stored = loadReminder("sample");
    expect(stored?.lastFiredAt).toBe(now.toISOString());
    expect(stored?.lastDeliveredAt).toBeNull();
    expect(stored?.lastDeliveryError).toBe("user canceled");
  });

  test("a Screen stub returning a success status records lastDeliveredAt and clears the error", () => {
    const reminder = makeReminder({ id: "sample" });
    saveReminder(reminder);
    const succeeding: Deliverer = {
      showDialog: () => ({ status: 0, stdout: "", stderr: "" }),
    };
    fireReminder(reminder, now, succeeding);
    const stored = loadReminder("sample");
    expect(stored?.lastDeliveredAt).toBe(now.toISOString());
    expect(stored?.lastDeliveryError).toBeNull();
  });
});
