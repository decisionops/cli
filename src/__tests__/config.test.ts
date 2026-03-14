import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { expandHome, decisionopsHome } from "../core/config.js";

describe("expandHome", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
    else delete process.env.USERPROFILE;
  });

  it("returns non-tilde paths unchanged", () => {
    expect(expandHome("/usr/local/bin")).toBe("/usr/local/bin");
    expect(expandHome("relative/path")).toBe("relative/path");
    expect(expandHome("")).toBe("");
  });

  it("expands bare ~ to HOME", () => {
    process.env.HOME = "/home/testuser";
    expect(expandHome("~")).toBe("/home/testuser");
  });

  it("expands ~/subpath using HOME", () => {
    process.env.HOME = "/home/testuser";
    expect(expandHome("~/Documents/file.txt")).toBe("/home/testuser/Documents/file.txt");
  });

  it("expands ~\\ on windows-style paths using HOME", () => {
    process.env.HOME = "/home/testuser";
    const result = expandHome("~\\Documents\\file.txt");
    expect(result).toContain("testuser");
    expect(result).not.toStartWith("~");
  });

  it("falls back to USERPROFILE when HOME is unset", () => {
    delete process.env.HOME;
    process.env.USERPROFILE = "C:\\Users\\testuser";
    expect(expandHome("~")).toBe("C:\\Users\\testuser");
  });

  it("returns ~ unchanged when neither HOME nor USERPROFILE is set", () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(expandHome("~")).toBe("~");
    expect(expandHome("~/foo")).toBe("~/foo");
  });

  it("does not expand ~username paths (only ~ and ~/)", () => {
    process.env.HOME = "/home/testuser";
    expect(expandHome("~other/foo")).toBe("~other/foo");
  });
});

describe("decisionopsHome", () => {
  const originalHome = process.env.HOME;
  const originalDecisionopsHome = process.env.DECISIONOPS_HOME;

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalDecisionopsHome !== undefined) process.env.DECISIONOPS_HOME = originalDecisionopsHome;
    else delete process.env.DECISIONOPS_HOME;
  });

  it("defaults to ~/.decisionops when env is unset", () => {
    delete process.env.DECISIONOPS_HOME;
    process.env.HOME = "/home/testuser";
    expect(decisionopsHome()).toBe("/home/testuser/.decisionops");
  });

  it("respects DECISIONOPS_HOME override", () => {
    process.env.DECISIONOPS_HOME = "/custom/dops";
    expect(decisionopsHome()).toBe("/custom/dops");
  });

  it("expands tilde in DECISIONOPS_HOME", () => {
    process.env.HOME = "/home/testuser";
    process.env.DECISIONOPS_HOME = "~/.my-dops";
    expect(decisionopsHome()).toBe("/home/testuser/.my-dops");
  });
});
