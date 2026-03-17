import {
  DEFAULT_INSTALL_BASE_URL,
  DEFAULT_RELEASE_REPO_SLUG,
  renderPowerShellInstaller,
  renderShellInstaller,
} from "../../src/installers/templates";

type Env = {
  PUBLIC_INSTALL_BASE_URL?: string;
  RELEASE_REPO_SLUG?: string;
};

const textHeaders = {
  "cache-control": "public, max-age=300",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function responseFor(request: Request, body: string, status = 200): Response {
  return request.method === "HEAD"
    ? new Response(null, { status, headers: textHeaders })
    : new Response(body, { status, headers: textHeaders });
}

function notFoundBody(baseUrl: string): string {
  return [
    "Not found.",
    "",
    "Available installer endpoints:",
    `  curl -fsSL ${baseUrl}/dops | sh`,
    `  irm ${baseUrl}/dops.ps1 | iex`,
    "",
  ].join("\n");
}

export default {
  fetch(request: Request, env: Env): Response {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed.\n", {
        status: 405,
        headers: {
          ...textHeaders,
          allow: "GET, HEAD",
        },
      });
    }

    const url = new URL(request.url);
    const installBaseUrl = (env.PUBLIC_INSTALL_BASE_URL ?? DEFAULT_INSTALL_BASE_URL).replace(/\/+$/, "");
    const releaseRepoSlug = env.RELEASE_REPO_SLUG ?? DEFAULT_RELEASE_REPO_SLUG;

    if (url.pathname === "/dops") {
      return responseFor(request, renderShellInstaller({ installBaseUrl, releaseRepoSlug }));
    }

    if (url.pathname === "/dops.ps1") {
      return responseFor(request, renderPowerShellInstaller({ installBaseUrl, releaseRepoSlug }));
    }

    if (url.pathname === "/healthz") {
      return responseFor(request, "ok\n");
    }

    if (url.pathname === "/") {
      return responseFor(request, notFoundBody(installBaseUrl));
    }

    return responseFor(request, notFoundBody(installBaseUrl), 404);
  },
};
