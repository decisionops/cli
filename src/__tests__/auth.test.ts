import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readAuthState,
  writeAuthState,
  clearAuthState,
  isExpired,
  saveTokenAuthState,
  type AuthState,
} from "../core/auth.js";

describe("auth (sync/pure functions)", () => {
  let tmpDir: string;
  const originalDecisionopsHome = process.env.DECISIONOPS_HOME;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dops-auth-test-"));
    process.env.DECISIONOPS_HOME = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDecisionopsHome !== undefined) {
      process.env.DECISIONOPS_HOME = originalDecisionopsHome;
    } else {
      delete process.env.DECISIONOPS_HOME;
    }
  });

  function makeAuthState(overrides: Partial<AuthState> = {}): AuthState {
    return {
      apiBaseUrl: "https://api.example.com",
      issuerUrl: "https://auth.example.com/oauth",
      clientId: "test-client",
      scopes: ["mcp:read"],
      tokenType: "Bearer",
      accessToken: "test-token-abc",
      issuedAt: new Date().toISOString(),
      method: "token",
      ...overrides,
    };
  }

  describe("writeAuthState / readAuthState", () => {
    it("round-trips auth state through write and read", () => {
      const state = makeAuthState();
      writeAuthState(state);
      const read = readAuthState();
      expect(read).not.toBeNull();
      expect(read!.accessToken).toBe("test-token-abc");
      expect(read!.apiBaseUrl).toBe("https://api.example.com");
      expect(read!.method).toBe("token");
      expect(read!.scopes).toEqual(["mcp:read"]);
    });

    it("creates auth.json with restricted permissions (mode 0600)", () => {
      writeAuthState(makeAuthState());
      const filePath = path.join(tmpDir, "auth.json");
      const stat = fs.statSync(filePath);
      // 0o600 = owner read+write only
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("preserves optional fields like refreshToken and user", () => {
      const state = makeAuthState({
        refreshToken: "refresh-xyz",
        expiresAt: "2099-01-01T00:00:00.000Z",
        user: { id: "u1", email: "test@example.com", name: "Test User" },
      });
      writeAuthState(state);
      const read = readAuthState();
      expect(read!.refreshToken).toBe("refresh-xyz");
      expect(read!.expiresAt).toBe("2099-01-01T00:00:00.000Z");
      expect(read!.user).toEqual({ id: "u1", email: "test@example.com", name: "Test User" });
    });

    it("overwrites existing auth state", () => {
      writeAuthState(makeAuthState({ accessToken: "first" }));
      writeAuthState(makeAuthState({ accessToken: "second" }));
      const read = readAuthState();
      expect(read!.accessToken).toBe("second");
    });
  });

  describe("readAuthState", () => {
    it("returns null when auth.json does not exist", () => {
      expect(readAuthState()).toBeNull();
    });

    it("returns null when accessToken is missing from stored JSON", () => {
      const filePath = path.join(tmpDir, "auth.json");
      fs.writeFileSync(filePath, JSON.stringify({ apiBaseUrl: "https://x.com" }), "utf8");
      expect(readAuthState()).toBeNull();
    });

    it("fills in defaults for missing fields", () => {
      const filePath = path.join(tmpDir, "auth.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ accessToken: "tok123" }),
        "utf8",
      );
      const read = readAuthState();
      expect(read).not.toBeNull();
      expect(read!.accessToken).toBe("tok123");
      expect(read!.apiBaseUrl).toBe("https://api.aidecisionops.com");
      expect(read!.tokenType).toBe("Bearer");
      expect(read!.method).toBe("token");
      expect(read!.scopes).toEqual(["mcp:read", "mcp:call", "decisions:read", "decisions:write", "decisions:approve", "admin:read"]);
    });
  });

  describe("clearAuthState", () => {
    it("removes auth.json when it exists", () => {
      writeAuthState(makeAuthState());
      const filePath = path.join(tmpDir, "auth.json");
      expect(fs.existsSync(filePath)).toBe(true);
      clearAuthState();
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("does not throw when auth.json does not exist", () => {
      expect(() => clearAuthState()).not.toThrow();
    });
  });

  describe("isExpired", () => {
    it("returns false when expiresAt is not set", () => {
      const state = makeAuthState({ expiresAt: undefined });
      expect(isExpired(state)).toBe(false);
    });

    it("returns false when expiry is far in the future", () => {
      const state = makeAuthState({ expiresAt: "2099-01-01T00:00:00.000Z" });
      expect(isExpired(state)).toBe(false);
    });

    it("returns true when expiry is in the past", () => {
      const state = makeAuthState({ expiresAt: "2020-01-01T00:00:00.000Z" });
      expect(isExpired(state)).toBe(true);
    });

    it("returns true when within skew window", () => {
      // Expires 10 seconds from now, but with 30s skew should be expired
      const expiresAt = new Date(Date.now() + 10_000).toISOString();
      const state = makeAuthState({ expiresAt });
      expect(isExpired(state, 30)).toBe(true);
    });

    it("returns false when outside skew window", () => {
      // Expires 60 seconds from now, default 30s skew
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const state = makeAuthState({ expiresAt });
      expect(isExpired(state)).toBe(false);
    });

    it("respects custom skew value", () => {
      const expiresAt = new Date(Date.now() + 5_000).toISOString();
      const state = makeAuthState({ expiresAt });
      expect(isExpired(state, 0)).toBe(false);
      expect(isExpired(state, 10)).toBe(true);
    });
  });

  describe("saveTokenAuthState", () => {
    it("saves token and returns state and storagePath", () => {
      const { state, storagePath } = saveTokenAuthState({ token: "my-api-token" });
      expect(state.accessToken).toBe("my-api-token");
      expect(state.method).toBe("token");
      expect(state.tokenType).toBe("Bearer");
      expect(fs.existsSync(storagePath)).toBe(true);
    });

    it("uses default API base URL when not specified", () => {
      const { state } = saveTokenAuthState({ token: "tok" });
      expect(state.apiBaseUrl).toBe("https://api.aidecisionops.com");
    });

    it("respects custom options", () => {
      const { state } = saveTokenAuthState({
        token: "tok",
        apiBaseUrl: "https://custom.api.com",
        scopes: ["custom:scope"],
      });
      expect(state.apiBaseUrl).toBe("https://custom.api.com");
      expect(state.scopes).toEqual(["custom:scope"]);
    });

    it("is readable back via readAuthState", () => {
      saveTokenAuthState({ token: "roundtrip-token" });
      const read = readAuthState();
      expect(read).not.toBeNull();
      expect(read!.accessToken).toBe("roundtrip-token");
    });
  });
});
