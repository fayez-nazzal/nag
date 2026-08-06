import { describe, expect, test } from "bun:test";
import {
  BUTTON_ACKNOWLEDGE,
  BUTTON_LATER,
  BUTTON_OPEN,
  DIALOG_TIMEOUT_SECONDS,
  actionForButton,
  buildDialogScript,
  buildNotificationScript,
  defaultButton,
  dialogButtons,
  escapeAppleScript,
} from "../src/deliver.ts";
import { ALL_CHANNELS, type Reminder } from "../src/reminder.ts";

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "sample",
    title: "Sample title",
    message: "First line\nSecond line",
    page: null,
    channels: ALL_CHANNELS,
    everySeconds: 600,
    startAt: null,
    lastFiredAt: null,
    acknowledgedAt: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("escapeAppleScript", () => {
  test("escapes quotes and backslashes", () => {
    expect(escapeAppleScript('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeAppleScript("back\\slash")).toBe("back\\\\slash");
  });

  test("escapes the backslash before the quote so the quote stays escaped", () => {
    expect(escapeAppleScript('\\"')).toBe('\\\\\\"');
  });
});

describe("dialog buttons", () => {
  test("offers Open only when a page is attached", () => {
    expect(dialogButtons(makeReminder())).toEqual([BUTTON_LATER, BUTTON_ACKNOWLEDGE]);
    expect(dialogButtons(makeReminder({ page: "/tmp/page.html" }))).toEqual([
      BUTTON_LATER,
      BUTTON_ACKNOWLEDGE,
      BUTTON_OPEN,
    ]);
  });

  test("never exceeds the three buttons AppleScript allows", () => {
    expect(dialogButtons(makeReminder({ page: "/tmp/page.html" })).length).toBeLessThanOrEqual(3);
  });

  test("defaults to Open when there is a page", () => {
    expect(defaultButton(makeReminder())).toBe(BUTTON_ACKNOWLEDGE);
    expect(defaultButton(makeReminder({ page: "/tmp/page.html" }))).toBe(BUTTON_OPEN);
  });
});

describe("buildDialogScript", () => {
  test("wraps the dialog in a long timeout", () => {
    const script = buildDialogScript(makeReminder());
    expect(script).toContain(`with timeout of ${DIALOG_TIMEOUT_SECONDS} seconds`);
    expect(script).toContain("end timeout");
  });

  test("keeps the timeout well past the 120 second Apple Event default", () => {
    expect(DIALOG_TIMEOUT_SECONDS).toBeGreaterThan(120);
  });

  test("carries the title and message", () => {
    const script = buildDialogScript(makeReminder({ title: "Overdue", message: "Do the thing" }));
    expect(script).toContain('with title "Overdue"');
    expect(script).toContain('display dialog "Do the thing"');
  });

  test("escapes a hostile title so the script stays one statement", () => {
    const script = buildDialogScript(makeReminder({ title: 'Bad" & (do shell script "rm -rf /") & "' }));
    expect(script).not.toContain('with title "Bad" &');
    expect(script).toContain('\\"');
  });
});

describe("buildNotificationScript", () => {
  test("uses only the first line of the message", () => {
    const script = buildNotificationScript(makeReminder());
    expect(script).toContain("First line");
    expect(script).not.toContain("Second line");
  });
});

describe("actionForButton", () => {
  test("maps every button", () => {
    expect(actionForButton(BUTTON_OPEN)).toBe("open");
    expect(actionForButton(BUTTON_ACKNOWLEDGE)).toBe("acknowledge");
    expect(actionForButton(BUTTON_LATER)).toBe("later");
  });

  test("treats an empty answer as no action, which is what a killed dialog returns", () => {
    expect(actionForButton("")).toBe("none");
  });
});
