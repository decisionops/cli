from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from .auth import ensure_valid_auth_state, read_auth_state
from .config import DEFAULT_API_BASE_URL
from .http import HttpStatusError, default_user_agent, urlopen_with_retries
from .manifest import read_manifest
from .tls import create_ssl_context


class DecisionOpsApiError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _format_auth_error_message(message: str) -> str:
    return "\n".join(
        [
            "Your saved DecisionOps login is no longer valid.",
            "Run `dops login` and try again.",
            "",
            f"Details: {message}",
        ]
    )


def _format_missing_scope_error_message(message: str) -> str:
    return "\n".join(
        [
            "Your saved DecisionOps login does not include the required permissions.",
            "Run `dops login --force` and try again.",
            "",
            f"Details: {message}",
        ]
    )


@dataclass(slots=True)
class DopsClient:
    api_base_url: str
    token: str
    org_id: str | None = None
    project_id: str | None = None
    repo_ref: str | None = None
    default_branch: str | None = None

    @classmethod
    def from_auth(cls, repo_path: str | None = None) -> "DopsClient":
        auth = read_auth_state()
        if auth is None:
            raise RuntimeError("Not authenticated. Run: dops login")
        valid_auth = ensure_valid_auth_state(auth)
        manifest = read_manifest(repo_path) if repo_path else None
        return cls(
            api_base_url=valid_auth.apiBaseUrl.rstrip("/"),
            token=valid_auth.accessToken,
            org_id=str(manifest.get("org_id")) if manifest and manifest.get("org_id") else None,
            project_id=str(manifest.get("project_id")) if manifest and manifest.get("project_id") else None,
            repo_ref=str(manifest.get("repo_ref")) if manifest and manifest.get("repo_ref") else None,
            default_branch=str(manifest.get("default_branch")) if manifest and manifest.get("default_branch") else None,
        )

    def request(self, method: str, path: str, body: Any | None = None) -> Any:
        url = f"{self.api_base_url}{path}"
        headers = {
            "accept": "application/json",
            "authorization": f"Bearer {self.token}",
            "user-agent": default_user_agent(),
        }
        payload = None
        if body is not None:
            headers["content-type"] = "application/json"
            payload = json.dumps(body).encode("utf8")
        request = urllib.request.Request(url, data=payload, method=method, headers=headers)
        try:
            response = urlopen_with_retries(request, timeout=10, context=create_ssl_context())
            content_type = response.headers.get("content-type", "")
            raw = response.body.decode("utf8")
            if "application/json" in content_type and raw:
                try:
                    return json.loads(raw)
                except json.JSONDecodeError as error:
                    raise DecisionOpsApiError(response.status, f"DecisionOps API returned invalid JSON for {url}.") from error
            return raw
        except HttpStatusError as error:
            raw = error.body.decode("utf8")
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = raw
            message = (
                payload
                if isinstance(payload, str)
                else str(payload.get("error") or payload.get("message") or error.reason)
            )
            final_message = (
                _format_auth_error_message(message or str(error.reason) or f"Request failed ({error.status})")
                if error.status == 401
                else _format_missing_scope_error_message(message or str(error.reason) or f"Request failed ({error.status})")
                if error.status == 403 and "missing scope" in (message or "").lower()
                else message or f"Request failed ({error.status})"
            )
            raise DecisionOpsApiError(error.status, final_message) from error
        except socket.timeout as error:
            raise DecisionOpsApiError(0, f"DecisionOps API timed out ({self.api_base_url}).") from error
        except urllib.error.URLError as error:
            raise DecisionOpsApiError(0, f"Could not reach DecisionOps API: {error.reason}") from error

    def load_user_context(self) -> dict[str, Any]:
        payload = self.request("GET", "/v1/auth/me")
        return payload if isinstance(payload, dict) else {}

    def load_project_repositories(self, project_id: str) -> dict[str, Any]:
        return self.request("GET", f"/v1/admin/projects/{urllib.parse.quote(project_id)}/repositories")

    def attach_repository_to_project(self, project_id: str, repo_id: str) -> dict[str, Any]:
        payload = self.request(
            "POST",
            f"/v1/admin/projects/{urllib.parse.quote(project_id)}/repositories",
            {"repoId": repo_id},
        )
        return payload if isinstance(payload, dict) else {}

    def switch_active_org(self, org_id: str) -> dict[str, Any]:
        payload = self.request("POST", "/v1/auth/switch-org", {"orgId": org_id})
        return payload if isinstance(payload, dict) else {}

    def switch_active_project(self, project_id: str) -> dict[str, Any]:
        payload = self.request("POST", "/v1/auth/switch-project", {"projectId": project_id})
        return payload if isinstance(payload, dict) else {}

    def create_organization(self, name: str, *, auto_generate_service_token: bool = False) -> dict[str, Any]:
        payload = self.request(
            "POST",
            "/v1/orgs",
            {"name": name, "autoGenerateServiceToken": auto_generate_service_token},
        )
        if isinstance(payload, dict):
            organization = payload.get("organization")
            return organization if isinstance(organization, dict) else payload
        return {}

    def create_project(self, name: str, *, set_default: bool = False) -> dict[str, Any]:
        payload = self.request("POST", "/v1/projects", {"name": name, "setDefault": set_default})
        if isinstance(payload, dict):
            project = payload.get("project")
            return project if isinstance(project, dict) else payload
        return {}

    def list_decisions(self, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        params = urllib.parse.urlencode({key: value for key, value in (filters or {}).items() if value is not None})
        payload = self.request("GET", f"/v1/decisions{'?' + params if params else ''}")
        if isinstance(payload, dict) and isinstance(payload.get("decisions"), list):
            return payload["decisions"]
        return payload if isinstance(payload, list) else []

    def get_decision(self, decision_id: str) -> dict[str, Any]:
        payload = self.request("GET", f"/v1/decisions/{urllib.parse.quote(decision_id)}")
        if isinstance(payload, dict):
            return payload.get("decision", payload)
        return {}

    def search_decisions(self, query: str, filters: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.request("POST", "/v1/decisions/search", {"query": query, **(filters or {})})

    def create_decision(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/v1/decisions", payload)

    def prepare_gate(self, repo_ref: str, task_summary: str, changed_paths: list[str] | None = None, branch: str | None = None) -> dict[str, Any]:
        return self.request(
            "POST",
            "/v1/decision-ops/gate",
            {"repo_ref": repo_ref, "task_summary": task_summary, "changed_paths": changed_paths, "branch": branch},
        )

    def create_draft(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/v1/decision-ops/draft", payload)

    def validate_decision(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/v1/decision-ops/validate", payload)

    def publish_decision(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/v1/decision-ops/publish", payload)

    def get_decision_ops(self, decision_id: str, project_id: str | None = None) -> dict[str, Any]:
        params = f"?project_id={urllib.parse.quote(project_id)}" if project_id else ""
        payload = self.request("GET", f"/v1/decision-ops/decisions/{urllib.parse.quote(decision_id)}{params}")
        return payload if isinstance(payload, dict) else {}

    def get_monitoring_snapshot(self) -> dict[str, Any]:
        payload = self.request("GET", "/v1/monitoring/snapshot")
        if isinstance(payload, dict):
            return payload.get("snapshot", payload)
        return {}

    def get_alerts(self, limit: int = 50) -> list[dict[str, Any]]:
        payload = self.request("GET", f"/v1/monitoring/alerts?limit={limit}")
        if isinstance(payload, dict) and isinstance(payload.get("alerts"), list):
            return payload["alerts"]
        return payload if isinstance(payload, list) else []

    def list_constraints(self, include_disabled: bool = False) -> list[dict[str, Any]]:
        params = "?includeDisabled=true" if include_disabled else ""
        payload = self.request("GET", f"/v1/admin/org-constraints{params}")
        if isinstance(payload, dict) and isinstance(payload.get("constraints"), list):
            return payload["constraints"]
        return payload if isinstance(payload, list) else []


def load_user_context(*, token: str, orgId: str | None = None, apiBaseUrl: str | None = None) -> dict[str, Any]:
    return DopsClient(api_base_url=(apiBaseUrl or DEFAULT_API_BASE_URL).rstrip("/"), token=token, org_id=orgId).load_user_context()


def load_project_repositories(*, token: str, orgId: str, projectId: str, apiBaseUrl: str | None = None) -> dict[str, Any]:
    return DopsClient(api_base_url=(apiBaseUrl or DEFAULT_API_BASE_URL).rstrip("/"), token=token, org_id=orgId).load_project_repositories(projectId)
