import { readAuthState, ensureValidAuthState, type AuthState } from "./auth.js";
import { DEFAULT_API_BASE_URL } from "./config.js";
import { readManifest } from "./manifest.js";

// ── Types aligned with API worker (decision-record) ──

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

export type ProjectRepository = {
  repoId: string;
  installationId?: string;
  repoFullName?: string;
  defaultBranch?: string;
};

export type ProjectRepositories = {
  project: ProjectSummary;
  repositories: ProjectRepository[];
};

// Decision type aligned with API worker's nested scope+content model
export type Decision = {
  decisionId: string;
  title: string;
  type: "technical" | "product" | "business" | "governance";
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  scopeType: "org" | "repo";
  scopeRepoId?: string;
  origin: "manual" | "agent";
  ownerEmail?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
};

// Full decision detail returned by GET /v1/decisions/:id
export type DecisionDetail = Decision & {
  scope?: { repos?: string[]; paths?: string[]; services?: string[]; tags?: string[] };
  content?: {
    constraints?: string[];
    supersedes?: string[];
    documentFormat?: string;
    document?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  sidekick?: { suggestions?: unknown[] };
};

// Input for POST /v1/decisions — aligned with createDecisionInputSchema
export type CreateDecisionInput = {
  title: string;
  type: "technical" | "product" | "business" | "governance";
  scope?: { repos?: string[]; paths?: string[]; services?: string[]; tags?: string[] };
  content?: {
    origin?: "manual" | "agent";
    constraints?: string[];
    supersedes?: string[];
    documentFormat?: string;
    document?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
};

// DecisionOps workflow types — aligned with Zod schemas in @decisionrecord/shared

export type GateResult = {
  org_id: string;
  project_id: string;
  repo: string;
  branch: string;
  recordable: boolean;
  classification_reason: string;
  risk_level: "low" | "medium" | "high";
  suggested_mode: "quick" | "comprehensive";
};

export type ValidationIssue = {
  code: string;
  field: string;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type PublishResult = {
  decision_id: string;
  status: "Accepted";
  supersede_updates: Array<{ old_id: string; superseded_by: string }>;
  published_at: string;
  version: number;
};

export type DraftResult = {
  decision_id: string;
  version: number;
  status: "Proposed";
};

export type MonitoringSnapshot = Record<string, unknown>;

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
  severity: "low" | "medium" | "high";
  appliesTo: "org" | "repo" | "all";
  status: "active" | "disabled";
};

export type SearchResult = {
  decisions: Decision[];
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

function toProjectRepository(value: unknown): ProjectRepository {
  if (typeof value === "string") return { repoId: value };
  const obj = value as Record<string, unknown>;
  return {
    repoId: String(obj.repoId ?? obj.repo_id ?? ""),
    installationId: obj.installationId ? String(obj.installationId) : undefined,
    repoFullName: obj.repoFullName ? String(obj.repoFullName) : undefined,
    defaultBranch: obj.defaultBranch ? String(obj.defaultBranch) : undefined,
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

  // ── Auth & workspace ──

  async loadUserContext(): Promise<UserContext> {
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
        ? payload.repositories.map(toProjectRepository)
        : [],
    };
  }

  // ── Decision CRUD (decisions-policy routes) ──

  async listDecisions(filters?: { status?: string; scopeType?: string; repoId?: string; source?: string; limit?: number }): Promise<Decision[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.scopeType) params.set("scopeType", filters.scopeType);
    if (filters?.repoId) params.set("repoId", filters.repoId);
    if (filters?.source) params.set("source", filters.source);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await this.request<Record<string, unknown>>("GET", `/v1/decisions${query}`);
    return (Array.isArray(payload.decisions) ? payload.decisions : []) as Decision[];
  }

  async getDecision(id: string): Promise<DecisionDetail> {
    const payload = await this.request<Record<string, unknown>>("GET", `/v1/decisions/${encodeURIComponent(id)}`);
    return (payload.decision ?? payload) as DecisionDetail;
  }

  async searchDecisions(query: string, filters?: { scopeType?: string; repoId?: string; status?: string; limit?: number }): Promise<SearchResult> {
    return this.request<SearchResult>("POST", "/v1/decisions/search", {
      query,
      ...filters,
    });
  }

  async createDecision(input: CreateDecisionInput): Promise<{ decision: Decision }> {
    return this.request<{ decision: Decision }>("POST", "/v1/decisions", input);
  }

  // ── DecisionOps workflow (decision-ops routes) ──

  async prepareGate(repoRef: string, taskSummary: string, changedPaths?: string[], branch?: string): Promise<GateResult> {
    return this.request<GateResult>("POST", "/v1/decision-ops/gate", {
      repo_ref: repoRef,
      task_summary: taskSummary,
      changed_paths: changedPaths,
      branch,
    });
  }

  async searchDecisionOps(terms: string[], mode: "quick" | "comprehensive" | "custom" = "quick", options?: { org_id?: string; project_id?: string; limit?: number; include_body?: boolean }): Promise<unknown> {
    return this.request<unknown>("POST", "/v1/decision-ops/search", {
      org_id: options?.org_id,
      project_id: options?.project_id,
      terms,
      mode,
      limit: options?.limit,
      include_body: options?.include_body,
    });
  }

  async createDraft(input: { org_id: string; project_id: string; title: string; context: string; decision: string; type?: string; options?: string[]; consequences?: string[]; related?: string[]; supersedes?: string[]; single_option_justification?: string; validation_plan?: { metric: string; baseline: string; target: string; by_date: string } }): Promise<DraftResult> {
    return this.request<DraftResult>("POST", "/v1/decision-ops/draft", input);
  }

  async validateDecision(input: { org_id: string; project_id: string; decision_id?: string; draft?: Record<string, unknown> }): Promise<ValidationResult> {
    return this.request<ValidationResult>("POST", "/v1/decision-ops/validate", input);
  }

  async publishDecision(input: { org_id: string; project_id: string; decision_id: string; expected_version: number }): Promise<PublishResult> {
    return this.request<PublishResult>("POST", "/v1/decision-ops/publish", input);
  }

  async getDecisionOps(id: string, projectId?: string): Promise<unknown> {
    const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return this.request<unknown>("GET", `/v1/decision-ops/decisions/${encodeURIComponent(id)}${params}`);
  }

  // ── Monitoring (rules-monitoring routes) ──

  async getMonitoringSnapshot(): Promise<MonitoringSnapshot> {
    const payload = await this.request<Record<string, unknown>>("GET", "/v1/monitoring/snapshot");
    return (payload.snapshot ?? payload) as MonitoringSnapshot;
  }

  async getAlerts(limit = 50): Promise<Alert[]> {
    const payload = await this.request<Record<string, unknown>>("GET", `/v1/monitoring/alerts?limit=${limit}`);
    return (Array.isArray(payload.alerts) ? payload.alerts : []) as Alert[];
  }

  // ── Admin (admin routes) ──

  async listConstraints(includeDisabled = false): Promise<OrgConstraint[]> {
    const params = includeDisabled ? "?includeDisabled=true" : "";
    const payload = await this.request<Record<string, unknown>>("GET", `/v1/admin/org-constraints${params}`);
    return (Array.isArray(payload.constraints) ? payload.constraints : []) as OrgConstraint[];
  }
}

// Re-export for backwards compatibility with controlPlane consumers
export async function loadUserContext(options: { token: string; orgId?: string; apiBaseUrl?: string; signal?: AbortSignal }): Promise<UserContext> {
  const client = new DopsClient({ apiBaseUrl: options.apiBaseUrl, token: options.token, orgId: options.orgId });
  return client.loadUserContext();
}

export async function loadProjectRepositories(options: {
  token: string; orgId: string; projectId: string; apiBaseUrl?: string; signal?: AbortSignal;
}): Promise<ProjectRepositories> {
  const client = new DopsClient({ apiBaseUrl: options.apiBaseUrl, token: options.token, orgId: options.orgId });
  return client.loadProjectRepositories(options.projectId);
}
