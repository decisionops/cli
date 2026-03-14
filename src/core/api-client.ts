import { readAuthState, ensureValidAuthState, type AuthState } from "./auth.js";
import { DEFAULT_API_BASE_URL } from "./config.js";
import { readManifest } from "./manifest.js";

export type UserOrganization = {
  orgId: string;
  orgName: string;
  role: "reader" | "contributor" | "approver" | "admin";
};

export type ProjectSummary = {
  id: string;
  orgId: string;
  projectKey: string;
  name: string;
  isDefault: boolean;
  status: "active" | "deactivated";
  repoCount: number;
  createdAt: string;
  updatedAt: string;
};

export type UserContext = {
  user?: { id?: string; email?: string; displayName?: string };
  activeOrganization: UserOrganization | null;
  organizations: UserOrganization[];
  activeProject: ProjectSummary | null;
  projects: ProjectSummary[];
};

export type ProjectRepositories = {
  project: ProjectSummary;
  repositories: string[];
};

export type Decision = {
  id: string;
  version: number;
  title: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  type: "technical" | "product" | "business" | "governance";
  context?: string;
  options?: Array<{ name: string; description?: string; pros?: string[]; cons?: string[] }>;
  outcome?: string;
  consequences?: string[];
  owner?: string;
  createdAt: string;
  updatedAt: string;
};

export type DecisionDraft = {
  title: string;
  type: "technical" | "product" | "business" | "governance";
  context?: string;
  options?: Array<{ name: string; description?: string; pros?: string[]; cons?: string[] }>;
  outcome?: string;
  consequences?: string[];
};

export type GateResult = {
  recordable: boolean;
  confidence: number;
  reasoning: string;
  suggestedType?: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type GovernanceSnapshot = {
  totalDecisions: number;
  coveragePercent: number;
  healthPercent: number;
  driftRate: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
};

export type Alert = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  createdAt: string;
};

export type OrgConstraint = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type SearchResult = {
  decisions: Decision[];
  total: number;
};

export class DecisionOpsApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DecisionOpsApiError";
    this.status = status;
  }
}

function toOrganization(value: Record<string, unknown>): UserOrganization {
  const role = String(value.role ?? "reader");
  return {
    orgId: String(value.orgId ?? ""),
    orgName: String(value.orgName ?? ""),
    role: role === "admin" || role === "approver" || role === "contributor" ? role : "reader",
  };
}

function toProjectSummary(value: Record<string, unknown>): ProjectSummary {
  return {
    id: String(value.id ?? ""),
    orgId: String(value.orgId ?? ""),
    projectKey: String(value.projectKey ?? ""),
    name: String(value.name ?? ""),
    isDefault: Boolean(value.isDefault),
    status: String(value.status ?? "") === "deactivated" ? "deactivated" : "active",
    repoCount: Number(value.repoCount ?? 0),
    createdAt: String(value.createdAt ?? ""),
    updatedAt: String(value.updatedAt ?? ""),
  };
}

export class DopsClient {
  private apiBaseUrl: string;
  private token: string;
  private orgId?: string;
  private projectId?: string;

  constructor(options: { apiBaseUrl?: string; token: string; orgId?: string; projectId?: string }) {
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
    this.token = options.token;
    this.orgId = options.orgId;
    this.projectId = options.projectId;
  }

  static async fromAuth(repoPath?: string): Promise<DopsClient> {
    const auth = readAuthState();
    if (!auth) throw new Error("Not authenticated. Run: dops login");
    const validAuth = await ensureValidAuthState(auth);
    const manifest = repoPath ? readManifest(repoPath) : null;
    return new DopsClient({
      apiBaseUrl: validAuth.apiBaseUrl,
      token: validAuth.accessToken,
      orgId: manifest?.org_id ? String(manifest.org_id) : undefined,
      projectId: manifest?.project_id ? String(manifest.project_id) : undefined,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const signals: AbortSignal[] = [AbortSignal.timeout(10000)];
    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.token}`,
          ...(this.orgId ? { "x-org-id": this.orgId } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new DecisionOpsApiError(0, `DecisionOps API timed out (${this.apiBaseUrl}).`);
      }
      const cause = error instanceof Error ? error.message : String(error);
      throw new DecisionOpsApiError(0, `Could not reach DecisionOps API: ${cause}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    if (!response.ok) {
      const message = typeof payload === "string"
        ? payload
        : String((payload as Record<string, unknown>).error ?? (payload as Record<string, unknown>).message ?? response.statusText);
      throw new DecisionOpsApiError(response.status, message || `Request failed (${response.status})`);
    }
    return payload as T;
  }

  // Auth & workspace
  async loadUserContext(orgId?: string): Promise<UserContext> {
    const payload = await this.request<Record<string, unknown>>("GET", "/v1/auth/me");
    const organizations = Array.isArray(payload.organizations)
      ? payload.organizations.map((v) => toOrganization(v as Record<string, unknown>))
      : [];
    const projects = Array.isArray(payload.projects)
      ? payload.projects.map((v) => toProjectSummary(v as Record<string, unknown>))
      : [];
    return {
      user: payload.user && typeof payload.user === "object"
        ? {
            id: String((payload.user as Record<string, unknown>).id ?? "") || undefined,
            email: String((payload.user as Record<string, unknown>).email ?? "") || undefined,
            displayName: String((payload.user as Record<string, unknown>).displayName ?? "") || undefined,
          }
        : undefined,
      activeOrganization: payload.activeOrganization && typeof payload.activeOrganization === "object"
        ? toOrganization(payload.activeOrganization as Record<string, unknown>)
        : null,
      organizations,
      activeProject: payload.activeProject && typeof payload.activeProject === "object"
        ? toProjectSummary(payload.activeProject as Record<string, unknown>)
        : null,
      projects,
    };
  }

  async loadProjectRepositories(projectId: string): Promise<ProjectRepositories> {
    const payload = await this.request<Record<string, unknown>>(
      "GET",
      `/v1/admin/projects/${encodeURIComponent(projectId)}/repositories`,
    );
    return {
      project: toProjectSummary((payload.project ?? {}) as Record<string, unknown>),
      repositories: Array.isArray(payload.repositories)
        ? payload.repositories.map((v) => String(v)).filter(Boolean)
        : [],
    };
  }

  // Decision CRUD
  async listDecisions(filters?: { status?: string; type?: string; limit?: number }): Promise<Decision[]> {
    const params = new URLSearchParams();
    if (this.projectId) params.set("project_id", this.projectId);
    if (filters?.status) params.set("status", filters.status);
    if (filters?.type) params.set("type", filters.type);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await this.request<Record<string, unknown>>("GET", `/v1/decisions${query}`);
    return (Array.isArray(payload.decisions) ? payload.decisions : []) as Decision[];
  }

  async getDecision(id: string): Promise<Decision> {
    return this.request<Decision>("GET", `/v1/decisions/${encodeURIComponent(id)}`);
  }

  async searchDecisions(terms: string, mode?: "semantic" | "keyword"): Promise<SearchResult> {
    const params = new URLSearchParams({ q: terms });
    if (this.projectId) params.set("project_id", this.projectId);
    if (mode) params.set("mode", mode);
    return this.request<SearchResult>("GET", `/v1/decisions/search?${params.toString()}`);
  }

  async createDecision(draft: DecisionDraft): Promise<{ decision_id: string; version: number }> {
    return this.request<{ decision_id: string; version: number }>("POST", "/v1/decisions", {
      ...draft,
      project_id: this.projectId,
    });
  }

  // DecisionOps workflow
  async prepareGate(taskSummary: string, changedPaths?: string[]): Promise<GateResult> {
    return this.request<GateResult>("POST", "/v1/decisions/gate", {
      task_summary: taskSummary,
      changed_paths: changedPaths,
      project_id: this.projectId,
    });
  }

  async validateDecision(idOrDraft: string | DecisionDraft): Promise<ValidationResult> {
    if (typeof idOrDraft === "string") {
      return this.request<ValidationResult>("POST", `/v1/decisions/${encodeURIComponent(idOrDraft)}/validate`);
    }
    return this.request<ValidationResult>("POST", "/v1/decisions/validate", idOrDraft);
  }

  async publishDecision(id: string, version?: number): Promise<{ decision_id: string; version: number }> {
    return this.request<{ decision_id: string; version: number }>(
      "POST",
      `/v1/decisions/${encodeURIComponent(id)}/publish`,
      version ? { version } : undefined,
    );
  }

  // Governance
  async getGovernanceSnapshot(): Promise<GovernanceSnapshot> {
    const params = this.projectId ? `?project_id=${encodeURIComponent(this.projectId)}` : "";
    return this.request<GovernanceSnapshot>("GET", `/v1/governance/snapshot${params}`);
  }

  async getAlerts(): Promise<Alert[]> {
    const params = this.projectId ? `?project_id=${encodeURIComponent(this.projectId)}` : "";
    const payload = await this.request<Record<string, unknown>>("GET", `/v1/governance/alerts${params}`);
    return (Array.isArray(payload.alerts) ? payload.alerts : []) as Alert[];
  }

  async listConstraints(): Promise<OrgConstraint[]> {
    const payload = await this.request<Record<string, unknown>>("GET", "/v1/governance/constraints");
    return (Array.isArray(payload.constraints) ? payload.constraints : []) as OrgConstraint[];
  }
}

// Re-export for backwards compatibility with controlPlane consumers
export async function loadUserContext(options: { token: string; orgId?: string; apiBaseUrl?: string; signal?: AbortSignal }): Promise<UserContext> {
  const client = new DopsClient({ apiBaseUrl: options.apiBaseUrl, token: options.token, orgId: options.orgId });
  return client.loadUserContext(options.orgId);
}

export async function loadProjectRepositories(options: {
  token: string; orgId: string; projectId: string; apiBaseUrl?: string; signal?: AbortSignal;
}): Promise<ProjectRepositories> {
  const client = new DopsClient({ apiBaseUrl: options.apiBaseUrl, token: options.token, orgId: options.orgId });
  return client.loadProjectRepositories(options.projectId);
}
