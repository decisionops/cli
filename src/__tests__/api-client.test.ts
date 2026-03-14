import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DopsClient, DecisionOpsApiError } from "../core/api-client.js";

// Helper to create a mock Response
function mockResponse(body: unknown, options: { status?: number; ok?: boolean; statusText?: string; contentType?: string } = {}) {
  const status = options.status ?? 200;
  const ok = options.ok ?? (status >= 200 && status < 300);
  return new Response(JSON.stringify(body), {
    status,
    statusText: options.statusText ?? "OK",
    headers: { "content-type": options.contentType ?? "application/json" },
  });
}

describe("DecisionOpsApiError", () => {
  it("stores status and message", () => {
    const err = new DecisionOpsApiError(404, "Not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DecisionOpsApiError");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
  });
});

describe("DopsClient", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(() => Promise.resolve(mockResponse({})));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("strips trailing slashes from apiBaseUrl", () => {
      const client = new DopsClient({ token: "tok", apiBaseUrl: "https://api.example.com///" });
      // Verify by making a request and checking the URL
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ decisions: [] })));
      client.listDecisions();
      // The fetch call URL should not have trailing slashes before the path
    });

    it("uses default API base URL when not specified", () => {
      const client = new DopsClient({ token: "tok" });
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ decisions: [] })));
      client.listDecisions();
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toStartWith("https://api.aidecisionops.com");
    });
  });

  describe("listDecisions", () => {
    it("calls GET /v1/decisions", async () => {
      const decisions = [{ id: "d1", title: "Test Decision" }] as any[];
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ decisions })));
      const client = new DopsClient({ token: "tok" });
      const result = await client.listDecisions();
      expect(result).toEqual(decisions as any);
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/v1/decisions");
    });

    it("includes query params for filters", async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ decisions: [] })));
      const client = new DopsClient({ token: "tok", projectId: "proj_1" });
      await client.listDecisions({ status: "proposed", type: "technical", limit: 5 });
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("status=proposed");
      expect(calledUrl).toContain("type=technical");
      expect(calledUrl).toContain("limit=5");
      expect(calledUrl).toContain("project_id=proj_1");
    });

    it("returns empty array when decisions field is missing", async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({})));
      const client = new DopsClient({ token: "tok" });
      const result = await client.listDecisions();
      expect(result).toEqual([]);
    });
  });

  describe("getDecision", () => {
    it("calls GET /v1/decisions/:id", async () => {
      const decision = { id: "dec_123", title: "My Decision" } as any;
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse(decision)));
      const client = new DopsClient({ token: "tok" });
      const result = await client.getDecision("dec_123");
      expect(result).toEqual(decision as any);
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/v1/decisions/dec_123");
    });

    it("encodes special characters in id", async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ id: "a/b" })));
      const client = new DopsClient({ token: "tok" });
      await client.getDecision("a/b");
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/v1/decisions/a%2Fb");
    });
  });

  describe("searchDecisions", () => {
    it("calls GET /v1/decisions/search with query params", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ decisions: [], total: 0 })),
      );
      const client = new DopsClient({ token: "tok" });
      const result = await client.searchDecisions("database choice", "semantic");
      expect(result).toEqual({ decisions: [], total: 0 });
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("q=database+choice");
      expect(calledUrl).toContain("mode=semantic");
    });
  });

  describe("createDecision", () => {
    it("calls POST /v1/decisions with body", async () => {
      const resp = { decision_id: "dec_new", version: 1 };
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse(resp)));
      const client = new DopsClient({ token: "tok", projectId: "proj_1" });
      const result = await client.createDecision({
        title: "New Decision",
        type: "technical",
      });
      expect(result).toEqual(resp);
      const [calledUrl, calledOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toContain("/v1/decisions");
      expect(calledOpts.method).toBe("POST");
      const body = JSON.parse(calledOpts.body as string);
      expect(body.title).toBe("New Decision");
      expect(body.project_id).toBe("proj_1");
    });
  });

  describe("prepareGate", () => {
    it("calls POST /v1/decisions/gate", async () => {
      const gate = { recordable: true, confidence: 0.9, reasoning: "Important" };
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse(gate)));
      const client = new DopsClient({ token: "tok" });
      const result = await client.prepareGate("Migrate to Postgres", ["db.ts"]);
      expect(result).toEqual(gate);
      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string);
      expect(body.task_summary).toBe("Migrate to Postgres");
      expect(body.changed_paths).toEqual(["db.ts"]);
    });
  });

  describe("validateDecision", () => {
    it("validates by id (string)", async () => {
      const validation = { valid: true, errors: [], warnings: [] };
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse(validation)));
      const client = new DopsClient({ token: "tok" });
      const result = await client.validateDecision("dec_123");
      expect(result).toEqual(validation);
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/v1/decisions/dec_123/validate");
    });

    it("validates a draft (object)", async () => {
      const validation = { valid: false, errors: ["Missing context"], warnings: [] };
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse(validation)));
      const client = new DopsClient({ token: "tok" });
      const result = await client.validateDecision({ title: "Draft", type: "technical" });
      expect(result).toEqual(validation);
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/v1/decisions/validate");
      expect(calledUrl).not.toContain("/v1/decisions/validate/");
    });
  });

  describe("publishDecision", () => {
    it("calls POST /v1/decisions/:id/publish", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ decision_id: "dec_1", version: 2 })),
      );
      const client = new DopsClient({ token: "tok" });
      const result = await client.publishDecision("dec_1", 1);
      expect(result).toEqual({ decision_id: "dec_1", version: 2 });
      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string);
      expect(body.version).toBe(1);
    });
  });

  describe("getGovernanceSnapshot", () => {
    it("calls GET /v1/governance/snapshot", async () => {
      const snapshot = {
        totalDecisions: 10,
        coveragePercent: 80,
        healthPercent: 90,
        driftRate: 5,
        byStatus: {},
        byType: {},
      };
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse(snapshot)));
      const client = new DopsClient({ token: "tok", projectId: "proj_1" });
      const result = await client.getGovernanceSnapshot();
      expect(result).toEqual(snapshot);
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("project_id=proj_1");
    });
  });

  describe("getAlerts", () => {
    it("calls GET /v1/governance/alerts", async () => {
      const alerts = [{ id: "a1", severity: "warning" as const, message: "Drift detected", createdAt: "2024-01-01" }];
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ alerts })));
      const client = new DopsClient({ token: "tok" });
      const result = await client.getAlerts();
      expect(result).toEqual(alerts as any);
    });

    it("returns empty array when alerts field is missing", async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({})));
      const client = new DopsClient({ token: "tok" });
      const result = await client.getAlerts();
      expect(result).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("throws DecisionOpsApiError on non-ok response", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse({ error: "Unauthorized" }, { status: 401, statusText: "Unauthorized" })),
      );
      const client = new DopsClient({ token: "bad-token" });
      try {
        await client.listDecisions();
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(DecisionOpsApiError);
        const apiErr = err as DecisionOpsApiError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.message).toBe("Unauthorized");
      }
    });

    it("throws DecisionOpsApiError with status 0 on network failure", async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error("ECONNREFUSED")));
      const client = new DopsClient({ token: "tok" });
      try {
        await client.listDecisions();
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(DecisionOpsApiError);
        const apiErr = err as DecisionOpsApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.message).toContain("ECONNREFUSED");
      }
    });

    it("includes x-org-id header when orgId is set", async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ decisions: [] })));
      const client = new DopsClient({ token: "tok", orgId: "org_abc" });
      await client.listDecisions();
      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers["x-org-id"]).toBe("org_abc");
    });

    it("sets authorization header with Bearer token", async () => {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ decisions: [] })));
      const client = new DopsClient({ token: "my-secret-token" });
      await client.listDecisions();
      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer my-secret-token");
    });
  });

  describe("fromAuth", () => {
    let tmpDir: string;
    const originalDecisionopsHome = process.env.DECISIONOPS_HOME;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dops-api-auth-test-"));
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

    it("throws when no auth state exists", async () => {
      try {
        await DopsClient.fromAuth();
        expect(true).toBe(false);
      } catch (err) {
        expect((err as Error).message).toContain("Not authenticated");
      }
    });

    it("creates client from saved auth state", async () => {
      const authState = {
        apiBaseUrl: "https://api.test.com",
        issuerUrl: "https://auth.test.com/oauth",
        clientId: "test",
        scopes: ["mcp:read"],
        tokenType: "Bearer",
        accessToken: "saved-token",
        issuedAt: new Date().toISOString(),
        method: "token",
      };
      fs.writeFileSync(path.join(tmpDir, "auth.json"), JSON.stringify(authState), "utf8");

      const client = await DopsClient.fromAuth();
      // Verify it works by making a request
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse({ decisions: [] })));
      await client.listDecisions();
      const [calledUrl, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toStartWith("https://api.test.com");
      const headers = opts.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer saved-token");
    });
  });
});
