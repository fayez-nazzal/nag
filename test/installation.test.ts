import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_LABEL,
  ZSHRC_BEGIN,
  ZSHRC_COMMAND,
  ZSHRC_END,
  addZshrcBlock,
  buildPlist,
  buildZshrcBlock,
  hasZshrcBlock,
  removeZshrcBlock,
  runInstall,
  type PlistOptions,
} from "../src/installation/apply.ts";

function makeOptions(overrides: Partial<PlistOptions> = {}): PlistOptions {
  return {
    label: AGENT_LABEL,
    bunPath: "/Users/someone/.bun/bin/bun",
    cliPath: "/Users/someone/repos/nag/src/cli.ts",
    intervalSeconds: 60,
    outLog: "/Users/someone/.nag/logs/launchd.out.log",
    errLog: "/Users/someone/.nag/logs/launchd.err.log",
    ...overrides,
  };
}

describe("buildPlist", () => {
  test("runs the dispatcher through bun", () => {
    const plist = buildPlist(makeOptions());
    expect(plist).toContain("<string>/Users/someone/.bun/bin/bun</string>");
    expect(plist).toContain("<string>/Users/someone/repos/nag/src/cli.ts</string>");
    expect(plist).toContain("<string>dispatch</string>");
  });

  test("wakes on the given interval and survives a reboot", () => {
    const plist = buildPlist(makeOptions({ intervalSeconds: 300 }));
    expect(plist).toContain("<integer>300</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<true/>");
  });

  test("escapes XML in a path", () => {
    const plist = buildPlist(makeOptions({ cliPath: "/tmp/a&b/cli.ts" }));
    expect(plist).toContain("/tmp/a&amp;b/cli.ts");
  });
});

describe("zshrc block", () => {
  test("is fenced by markers", () => {
    const block = buildZshrcBlock();
    expect(block.startsWith(ZSHRC_BEGIN)).toBe(true);
    expect(block.endsWith(ZSHRC_END)).toBe(true);
    expect(block).toContain(ZSHRC_COMMAND);
  });

  test("adds once and stays put on a second add", () => {
    const first = addZshrcBlock("export PATH=/bin\n");
    const second = addZshrcBlock(first);
    expect(first).toBe(second);
    expect(first.match(new RegExp(ZSHRC_BEGIN, "g"))).toHaveLength(1);
    expect(hasZshrcBlock(first)).toBe(true);
  });

  test("keeps the original content when adding", () => {
    expect(addZshrcBlock("export PATH=/bin\n")).toContain("export PATH=/bin");
  });

  test("handles an empty rc file", () => {
    expect(addZshrcBlock("")).toBe(`${buildZshrcBlock()}\n`);
  });

  test("removes the block and leaves everything else", () => {
    const withBlock = addZshrcBlock("export PATH=/bin\nalias l=ls\n");
    const cleaned = removeZshrcBlock(withBlock);
    expect(cleaned).toContain("export PATH=/bin");
    expect(cleaned).toContain("alias l=ls");
    expect(hasZshrcBlock(cleaned)).toBe(false);
    expect(cleaned).not.toContain(ZSHRC_COMMAND);
  });

  test("removing from a file that never had it changes nothing meaningful", () => {
    expect(removeZshrcBlock("alias l=ls")).toBe("alias l=ls");
  });
});

describe("removeZshrcBlock truncation guard", () => {
  test("keeps every line after a missing END marker", () => {
    const content = "alias l=ls\n# >>> nag banner >>>\nnag banner\nexport A=1\n";
    expect(removeZshrcBlock(content)).toContain("export A=1");
  });

  test("leaves content untouched, trailing newline included, when END is missing", () => {
    const content = "alias l=ls\n# >>> nag banner >>>\nnag banner\nexport A=1\n";
    expect(removeZshrcBlock(content)).toBe(content);
  });

  test("still strips the block cleanly when both markers are present", () => {
    const content = "alias l=ls\n# >>> nag banner >>>\nnag banner\n# <<< nag banner <<<\nexport A=1\n";
    const cleaned = removeZshrcBlock(content);
    expect(cleaned).toContain("export A=1");
    expect(cleaned).not.toContain(ZSHRC_BEGIN);
  });
});

describe("zshrc block against a temp file", () => {
  test("adds then removes the block on a throwaway file, never the real home directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "nag-rc-"));
    const rcPath = join(dir, "zshrc-fixture");
    writeFileSync(rcPath, "export A=1\n");
    writeFileSync(rcPath, addZshrcBlock(readFileSync(rcPath, "utf8")));
    expect(readFileSync(rcPath, "utf8")).toContain(ZSHRC_BEGIN);
    writeFileSync(rcPath, removeZshrcBlock(readFileSync(rcPath, "utf8")));
    const updated = readFileSync(rcPath, "utf8");
    expect(updated).toContain("export A=1");
    expect(updated).not.toContain(ZSHRC_BEGIN);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("runInstall reports a bootstrap failure as a failure", () => {
  test("a CommandRunner stub returning a failed status makes runInstall throw instead of reporting success", () => {
    const dir = mkdtempSync(join(tmpdir(), "nag-install-"));
    const rcPath = join(dir, "zshrc-fixture");
    const plistPath = join(dir, "agent.plist");
    process.env.NAG_HOME = join(dir, "home");
    const failingRunner = () => {
      return { status: 1, stdout: "", stderr: "service could not be loaded" };
    };
    expect(() => runInstall(60, rcPath, plistPath, failingRunner)).toThrow(/service could not be loaded/);
    delete process.env.NAG_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  test("a CommandRunner stub returning success lets runInstall report the agent loaded", () => {
    const dir = mkdtempSync(join(tmpdir(), "nag-install-"));
    const rcPath = join(dir, "zshrc-fixture");
    const plistPath = join(dir, "agent.plist");
    process.env.NAG_HOME = join(dir, "home");
    const succeedingRunner = () => {
      return { status: 0, stdout: "", stderr: "" };
    };
    const notes = runInstall(60, rcPath, plistPath, succeedingRunner);
    expect(notes.join("\n")).toContain("agent loaded");
    delete process.env.NAG_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("runInstall resolves cliPath relative to src, not to installation/", () => {
  test("the plist it writes points at a cli.ts that actually exists on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "nag-cli-path-"));
    const rcPath = join(dir, "zshrc-fixture");
    const plistPath = join(dir, "agent.plist");
    process.env.NAG_HOME = join(dir, "home");
    const succeedingRunner = () => {
      return { status: 0, stdout: "", stderr: "" };
    };
    runInstall(60, rcPath, plistPath, succeedingRunner);
    const plist = readFileSync(plistPath, "utf8");
    const match = /<string>([^<]*cli\.ts)<\/string>/.exec(plist);
    expect(match).not.toBeNull();
    expect(existsSync(match![1]!)).toBe(true);
    delete process.env.NAG_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("AGENT_LABEL matches the running launchd agent", () => {
  test("AGENT_LABEL is io.fayez.nag, the only plist that actually exists on disk", () => {
    expect(AGENT_LABEL).toBe("io.fayez.nag");
  });
});
