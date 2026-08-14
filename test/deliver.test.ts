import { describe, expect, test } from "bun:test";
import { DIALOG_TIMEOUT_SECONDS, buildDialogScript, dialogMessage, escapeAppleScript } from "../src/deliver.ts";
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
    lastDeliveredAt: null,
    lastDeliveryError: null,
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

describe("dialogMessage", () => {
  test("carries the page as text in the dialog body instead of a button", () => {
    expect(dialogMessage(makeReminder())).not.toContain("Open:");
    expect(dialogMessage(makeReminder({ page: "/tmp/page.html" }))).toContain("Open: /tmp/page.html");
  });
});

describe("buildDialogScript", () => {
  test("wraps the dialog in a bounded timeout", () => {
    const script = buildDialogScript(makeReminder());
    expect(script).toContain(`with timeout of ${DIALOG_TIMEOUT_SECONDS} seconds`);
    expect(script).toContain("end timeout");
  });

  test("keeps the timeout well past the 120 second Apple Event default", () => {
    expect(DIALOG_TIMEOUT_SECONDS).toBeGreaterThan(120);
  });

  test("offers a single OK button", () => {
    const script = buildDialogScript(makeReminder());
    expect(script).toContain('buttons {"OK"}');
    expect(script).toContain('default button "OK"');
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
