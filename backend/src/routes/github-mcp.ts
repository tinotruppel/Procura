/**
 * GitHub MCP Server
 * Implements the Model Context Protocol for GitHub repository data and workflows
 *
 * Endpoint: /mcp/github
 * Transport: Streamable HTTP via @hono/mcp
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";

const GITHUB_API_BASE = "https://api.github.com";

interface GitHubAuth {
    token?: string;
}

interface GitHubRepo {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    description: string | null;
    default_branch: string;
    archived: boolean;
}

interface GitHubIssue {
    id: number;
    number: number;
    title: string;
    state: "open" | "closed";
    html_url: string;
    user?: { login: string };
    pull_request?: { url: string };
}

interface GitHubPullRequest {
    id: number;
    number: number;
    title: string;
    state: "open" | "closed";
    html_url: string;
    user?: { login: string };
}

interface GitHubContentItem {
    name: string;
    path: string;
    sha: string;
    size: number;
    type: "file" | "dir";
    download_url: string | null;
}

interface GitHubFileContent {
    name: string;
    path: string;
    sha: string;
    size: number;
    type: "file";
    content?: string;
    encoding?: string;
    download_url: string | null;
}

interface GitHubGist {
    id: string;
    description: string | null;
    html_url: string;
    public: boolean;
    files: Record<string, { filename: string }>;
}

interface GitHubWorkflow {
    id: number;
    name: string;
    state: string;
    path: string;
    html_url: string;
}

interface GitHubWorkflowRun {
    id: number;
    name: string | null;
    status: string;
    conclusion: string | null;
    html_url: string;
    run_number: number;
    event: string;
}

interface GitHubAuthenticatedUser {
    login: string;
}
function getDefaultAuth(): GitHubAuth {
    return {
        token: process.env.GITHUB_TOKEN || undefined,
    };
}

async function githubRequest<T>(path: string, auth: GitHubAuth, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (auth.token) {
        headers.Authorization = `Bearer ${auth.token}`;
    }
    if (options?.headers) {
        Object.assign(headers, options.headers);
    }
    if (options?.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    const response = await fetch(`${GITHUB_API_BASE}${path}`, { ...options, headers });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        const detail = text ? ` - ${text}` : "";
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}${detail}`);
    }
    return response.json() as Promise<T>;
}

const mcpServer = new McpServer({
    name: "github",
    version: "1.0.0",
});

const auth = getDefaultAuth();

// --- list_projects (repositories) ---
mcpServer.registerTool(
    "list_projects",
    {
        description: "List available projects (repositories) for a user or organization",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            page: z.number().optional().describe("Page number (default: 1)"),
            per_page: z.number().optional().describe("Results per page (default: 30, max: 100)"),
        },
    },
    async ({ owner, page = 1, per_page = 30 }) => {
        const perPage = Math.min(per_page, 100);
        const typeParam = "all";
        let repos: GitHubRepo[] = [];
        let source: "orgs" | "users" | "auth_user" = "users";

        const orgPath = `/orgs/${encodeURIComponent(owner)}/repos?type=${typeParam}&per_page=${perPage}&page=${page}`;
        const userPath = `/users/${encodeURIComponent(owner)}/repos?type=${typeParam}&per_page=${perPage}&page=${page}`;
        const authUserPath = `/user/repos?type=${typeParam}&per_page=${perPage}&page=${page}`;

        if (auth.token) {
            try {
                const authUser = await githubRequest<GitHubAuthenticatedUser>("/user", auth);
                if (authUser.login.toLowerCase() === owner.toLowerCase()) {
                    repos = await githubRequest<GitHubRepo[]>(authUserPath, auth);
                    source = "auth_user";
                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({
                                source,
                                projects: repos.map(r => ({
                                    id: r.id,
                                    name: r.name,
                                    fullName: r.full_name,
                                    private: r.private,
                                    url: r.html_url,
                                    description: r.description,
                                    defaultBranch: r.default_branch,
                                    archived: r.archived,
                                })),
                            }, null, 2),
                        }],
                    };
                }
            } catch {
                // Fall back to orgs/users listing
            }
        }

        try {
            repos = await githubRequest<GitHubRepo[]>(orgPath, auth);
            source = "orgs";
        } catch {
            repos = await githubRequest<GitHubRepo[]>(userPath, auth);
            source = "users";
        }
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    source,
                    projects: repos.map(r => ({
                        id: r.id,
                        name: r.name,
                        fullName: r.full_name,
                        private: r.private,
                        url: r.html_url,
                        description: r.description,
                        defaultBranch: r.default_branch,
                        archived: r.archived,
                    })),
                }, null, 2),
            }],
        };
    }
);

// --- get_project ---
mcpServer.registerTool(
    "get_project",
    {
        description: "Get details for a specific project (repository)",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
        },
    },
    async ({ owner, repo }) => {
        const project = await githubRequest<GitHubRepo>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    id: project.id,
                    name: project.name,
                    fullName: project.full_name,
                    private: project.private,
                    url: project.html_url,
                    description: project.description,
                    defaultBranch: project.default_branch,
                    archived: project.archived,
                }, null, 2),
            }],
        };
    }
);

// --- list_issues ---
mcpServer.registerTool(
    "list_issues",
    {
        description: "List issues for a project (excluding pull requests by default)",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            state: z.enum(["open", "closed", "all"]).optional().describe("Issue state (default: open)"),
            includePullRequests: z.boolean().optional().describe("Include pull requests in results (default: false)"),
            page: z.number().optional().describe("Page number (default: 1)"),
            per_page: z.number().optional().describe("Results per page (default: 30, max: 100)"),
        },
    },
    async ({ owner, repo, state = "open", includePullRequests = false, page = 1, per_page = 30 }) => {
        const issues = await githubRequest<GitHubIssue[]>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${state}&per_page=${Math.min(per_page, 100)}&page=${page}`,
            auth
        );
        const filtered = includePullRequests ? issues : issues.filter(issue => !issue.pull_request);
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    issues: filtered.map(issue => ({
                        id: issue.id,
                        number: issue.number,
                        title: issue.title,
                        state: issue.state,
                        url: issue.html_url,
                        author: issue.user?.login || "unknown",
                        isPullRequest: !!issue.pull_request,
                    })),
                }, null, 2),
            }],
        };
    }
);

// --- get_issue ---
mcpServer.registerTool(
    "get_issue",
    {
        description: "Get details for a specific issue",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            issueNumber: z.number().describe("Issue number"),
        },
    },
    async ({ owner, repo, issueNumber }) => {
        const issue = await githubRequest<GitHubIssue>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    id: issue.id,
                    number: issue.number,
                    title: issue.title,
                    state: issue.state,
                    url: issue.html_url,
                    author: issue.user?.login || "unknown",
                    isPullRequest: !!issue.pull_request,
                }, null, 2),
            }],
        };
    }
);

// --- list_pull_requests ---
mcpServer.registerTool(
    "list_pull_requests",
    {
        description: "List pull requests for a project",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            state: z.enum(["open", "closed", "all"]).optional().describe("Pull request state (default: open)"),
            page: z.number().optional().describe("Page number (default: 1)"),
            per_page: z.number().optional().describe("Results per page (default: 30, max: 100)"),
        },
    },
    async ({ owner, repo, state = "open", page = 1, per_page = 30 }) => {
        const pulls = await githubRequest<GitHubPullRequest[]>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&per_page=${Math.min(per_page, 100)}&page=${page}`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    pullRequests: pulls.map(pr => ({
                        id: pr.id,
                        number: pr.number,
                        title: pr.title,
                        state: pr.state,
                        url: pr.html_url,
                        author: pr.user?.login || "unknown",
                    })),
                }, null, 2),
            }],
        };
    }
);

// --- get_pull_request ---
mcpServer.registerTool(
    "get_pull_request",
    {
        description: "Get details for a specific pull request",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            pullNumber: z.number().describe("Pull request number"),
        },
    },
    async ({ owner, repo, pullNumber }) => {
        const pr = await githubRequest<GitHubPullRequest>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    id: pr.id,
                    number: pr.number,
                    title: pr.title,
                    state: pr.state,
                    url: pr.html_url,
                    author: pr.user?.login || "unknown",
                }, null, 2),
            }],
        };
    }
);

// --- list_files ---
mcpServer.registerTool(
    "list_files",
    {
        description: "List files or directories in a project path",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            path: z.string().optional().describe("Path within the repository (default: root)"),
            ref: z.string().optional().describe("Git ref (branch, tag, or commit SHA)"),
        },
    },
    async ({ owner, repo, path = "", ref }) => {
        const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
        const items = await githubRequest<GitHubContentItem[]>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}${refParam}`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    path: path || "/",
                    items: items.map(item => ({
                        name: item.name,
                        path: item.path,
                        type: item.type,
                        size: item.size,
                        downloadUrl: item.download_url,
                    })),
                }, null, 2),
            }],
        };
    }
);

// --- get_file ---
mcpServer.registerTool(
    "get_file",
    {
        description: "Get file contents from a project path",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            path: z.string().describe("Path to the file within the repository"),
            ref: z.string().optional().describe("Git ref (branch, tag, or commit SHA)"),
            decode: z.boolean().optional().describe("Decode base64 content (default: true)"),
        },
    },
    async ({ owner, repo, path, ref, decode = true }) => {
        const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
        const file = await githubRequest<GitHubFileContent>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}${refParam}`,
            auth
        );
        let content = file.content || "";
        if (decode && file.encoding === "base64" && content) {
            content = Buffer.from(content, "base64").toString("utf-8");
        }
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    name: file.name,
                    path: file.path,
                    size: file.size,
                    encoding: file.encoding,
                    content,
                    downloadUrl: file.download_url,
                }, null, 2),
            }],
        };
    }
);

// --- list_gists ---
mcpServer.registerTool(
    "list_gists",
    {
        description: "List gists for a user or the authenticated account",
        inputSchema: {
            owner: z.string().optional().describe("GitHub username (optional; defaults to authenticated user)"),
            page: z.number().optional().describe("Page number (default: 1)"),
            per_page: z.number().optional().describe("Results per page (default: 30, max: 100)"),
        },
    },
    async ({ owner, page = 1, per_page = 30 }) => {
        const perPage = Math.min(per_page, 100);
        const path = owner
            ? `/users/${encodeURIComponent(owner)}/gists?per_page=${perPage}&page=${page}`
            : `/gists?per_page=${perPage}&page=${page}`;
        const gists = await githubRequest<GitHubGist[]>(path, auth);
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    gists: gists.map(g => ({
                        id: g.id,
                        description: g.description,
                        url: g.html_url,
                        public: g.public,
                        files: Object.keys(g.files || {}),
                    })),
                }, null, 2),
            }],
        };
    }
);

// --- get_gist ---
mcpServer.registerTool(
    "get_gist",
    {
        description: "Get details for a gist",
        inputSchema: {
            gistId: z.string().describe("Gist ID"),
        },
    },
    async ({ gistId }) => {
        const gist = await githubRequest<GitHubGist>(`/gists/${encodeURIComponent(gistId)}`, auth);
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    id: gist.id,
                    description: gist.description,
                    url: gist.html_url,
                    public: gist.public,
                    files: Object.keys(gist.files || {}),
                }, null, 2),
            }],
        };
    }
);

// --- create_gist ---
mcpServer.registerTool(
    "create_gist",
    {
        description: "Create a new gist",
        inputSchema: {
            description: z.string().optional().describe("Gist description"),
            public: z.boolean().optional().describe("Whether the gist is public (default: false)"),
            files: z.record(z.string()).describe("Files as { filename: content }"),
        },
    },
    async ({ description, public: isPublic = false, files }) => {
        const payload = {
            description: description || "",
            public: isPublic,
            files: Object.fromEntries(
                Object.entries(files).map(([filename, content]) => [filename, { content }])
            ),
        };
        const gist = await githubRequest<GitHubGist>("/gists", auth, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    id: gist.id,
                    url: gist.html_url,
                    public: gist.public,
                }, null, 2),
            }],
        };
    }
);

// --- list_workflows ---
mcpServer.registerTool(
    "list_workflows",
    {
        description: "List workflows for a project",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
        },
    },
    async ({ owner, repo }) => {
        const result = await githubRequest<{ workflows: GitHubWorkflow[] }>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    workflows: result.workflows.map(w => ({
                        id: w.id,
                        name: w.name,
                        state: w.state,
                        path: w.path,
                        url: w.html_url,
                    })),
                }, null, 2),
            }],
        };
    }
);

// --- get_workflow ---
mcpServer.registerTool(
    "get_workflow",
    {
        description: "Get a workflow by ID or file name",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            workflowId: z.string().describe("Workflow ID or file name"),
        },
    },
    async ({ owner, repo, workflowId }) => {
        const workflow = await githubRequest<GitHubWorkflow>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    id: workflow.id,
                    name: workflow.name,
                    state: workflow.state,
                    path: workflow.path,
                    url: workflow.html_url,
                }, null, 2),
            }],
        };
    }
);

// --- list_workflow_runs ---
mcpServer.registerTool(
    "list_workflow_runs",
    {
        description: "List workflow runs for a project",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            workflowId: z.string().optional().describe("Workflow ID or file name (optional)"),
            page: z.number().optional().describe("Page number (default: 1)"),
            per_page: z.number().optional().describe("Results per page (default: 30, max: 100)"),
        },
    },
    async ({ owner, repo, workflowId, page = 1, per_page = 30 }) => {
        const perPage = Math.min(per_page, 100);
        const base = workflowId
            ? `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/runs`
            : `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs`;
        const result = await githubRequest<{ workflow_runs: GitHubWorkflowRun[] }>(
            `${base}?per_page=${perPage}&page=${page}`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    runs: result.workflow_runs.map(run => ({
                        id: run.id,
                        name: run.name,
                        status: run.status,
                        conclusion: run.conclusion,
                        url: run.html_url,
                        runNumber: run.run_number,
                        event: run.event,
                    })),
                }, null, 2),
            }],
        };
    }
);

// --- trigger_workflow ---
mcpServer.registerTool(
    "trigger_workflow",
    {
        description: "Trigger a workflow dispatch",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            workflowId: z.string().describe("Workflow ID or file name"),
            ref: z.string().describe("Git ref (branch or tag)"),
            inputs: z.record(z.string()).optional().describe("Workflow inputs"),
        },
    },
    async ({ owner, repo, workflowId, ref, inputs }) => {
        await githubRequest<void>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
            auth,
            {
                method: "POST",
                body: JSON.stringify({ ref, inputs }),
            }
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    message: "Workflow dispatch triggered",
                }, null, 2),
            }],
        };
    }
);

// --- cancel_workflow_run ---
mcpServer.registerTool(
    "cancel_workflow_run",
    {
        description: "Cancel a workflow run",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            runId: z.number().describe("Workflow run ID"),
        },
    },
    async ({ owner, repo, runId }) => {
        await githubRequest<void>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/cancel`,
            auth,
            { method: "POST" }
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    message: "Workflow run canceled",
                }, null, 2),
            }],
        };
    }
);

// --- search_code ---
mcpServer.registerTool(
    "search_code",
    {
        description: "Search code within a project",
        inputSchema: {
            owner: z.string().describe("GitHub username or organization name"),
            repo: z.string().describe("Repository name"),
            query: z.string().describe("Search query (GitHub code search syntax)"),
            path: z.string().optional().describe("Optional path qualifier"),
            per_page: z.number().optional().describe("Results per page (default: 30, max: 100)"),
            page: z.number().optional().describe("Page number (default: 1)"),
        },
    },
    async ({ owner, repo, query, path, per_page = 30, page = 1 }) => {
        const qualifiers = [`repo:${owner}/${repo}`];
        if (path) {
            qualifiers.push(`path:${path}`);
        }
        const q = encodeURIComponent([query, ...qualifiers].join(" "));
        const results = await githubRequest<{ items: GitHubContentItem[] }>(
            `/search/code?q=${q}&per_page=${Math.min(per_page, 100)}&page=${page}`,
            auth
        );
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    items: results.items.map(item => ({
                        name: item.name,
                        path: item.path,
                        type: item.type,
                        size: item.size,
                        downloadUrl: item.download_url,
                    })),
                }, null, 2),
            }],
        };
    }
);

// =============================================================================
// HTTP Routes with Hono MCP Transport
// =============================================================================

export const githubMcpRoutes = new Hono();
const transport = new StreamableHTTPTransport();

githubMcpRoutes.all("/", async (c) => {
    if (!mcpServer.isConnected()) {
        await mcpServer.connect(transport);
    }
    return transport.handleRequest(c);
});

githubMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "github",
        version: "1.0.0",
        description: "GitHub access (read with limited write actions)",
        status: "ready",
        configured: true,
        tokenConfigured: !!auth.token,
        tools: [
            "list_projects", "get_project",
            "list_issues", "get_issue",
            "list_pull_requests", "get_pull_request",
            "list_files", "get_file", "search_code",
            "list_gists", "get_gist", "create_gist",
            "list_workflows", "get_workflow", "list_workflow_runs",
            "trigger_workflow", "cancel_workflow_run",
        ],
        note: auth.token ? undefined : "Set GITHUB_TOKEN for higher rate limits or private repositories",
    });
});
