import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedApp, parseAuthRoute } from "../src/app/AuthenticatedApp";
import { createLocaleRender } from "./helpers/renderWithLocale";
import { invitationStorageKey } from "../src/features/auth/invitation";

const render = createLocaleRender("zh-CN");

const userId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000003";
const now = "2026-10-22T10:00:00Z";
const user = (id = userId, name = "Alice") => ({ id, name, email: `${name}@example.com`, emailVerified: true, avatarUrl: null });
const project = (name = "私有项目") => ({ id: projectId, name, repoUrl: "https://github.com/example/repo", createdAt: now, updatedAt: now });
const member = (id = userId, role = "admin") => ({ projectId, userId: id, name: "Alice", email: "alice@example.com", avatarUrl: null, role, version: 12, createdAt: now, updatedAt: now });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (status: number, code: string) => json({ error: { code, message: "hidden server details", requestId: "rq-safe" } }, status);
const graph = () => json({ project: project(), tasks: [], summary: { total: 0, proposed: 0, todo: 0, inProgress: 0, done: 0, ready: 0, blocked: 0 } });
const defaults = (url: string): Response => {
  if (url === "/api/v1/me") return json(user());
  if (url === "/api/v1/auth/providers") return json({ providers: ["github"] });
  if (url.endsWith("/members")) return json({ items: [member()] });
  if (url.endsWith("/task-graph")) return graph();
  if (url.startsWith("/api/v1/projects")) return json({ items: [project()], nextCursor: null });
  throw new Error(`Unexpected request ${url}`);
};
const install = (handler = defaults) => {
  const fetcher = vi.fn((url: string, _options?: RequestInit) => Promise.resolve(handler(url)));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

beforeEach(() => {
  window.sessionStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
});

describe("authenticated application shell", () => {
  it("waits for identity before requesting project data and renders the real project list", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn((url: string) => url === "/api/v1/me" ? new Promise<Response>((done) => { resolve = done; }) : Promise.resolve(defaults(url)));
    vi.stubGlobal("fetch", fetcher);
    render(<AuthenticatedApp />);
    expect(screen.getByRole("heading", { name: "正在确认登录状态" })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => resolve(json(user())));
    await screen.findByRole("heading", { name: "私有项目" });
    expect(screen.getByRole("link", { name: "账户设置：Alice" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "账户设置：Alice" })).toHaveAttribute("aria-label", "账户设置：Alice");
  });

  it("only shows configured login providers and sends a local return path", async () => {
    install((url) => url === "/api/v1/me" ? fail(401, "unauthenticated") : defaults(url));
    const login = vi.fn();
    window.history.replaceState(null, "", `/projects/${projectId}`);
    render(<AuthenticatedApp navigateToLogin={login} />);
    fireEvent.click(await screen.findByRole("button", { name: "使用 GitHub 登录" }));
    expect(screen.queryByRole("button", { name: "使用 Google 登录" })).toBeNull();
    expect(screen.queryByText("登录状态已过期。重新登录后可继续访问项目。")).toBeNull();
    expect(login).toHaveBeenCalledWith(`/api/v1/auth/login?provider=github&returnPath=%2Fprojects%2F${projectId}`);
    expect(screen.getByRole("button", { name: "正在前往 UniAuth…" })).toBeDisabled();
  });

  it("keeps provider loading failures distinct from an empty configured provider set", async () => {
    let providerCalls = 0;
    install((url) => url === "/api/v1/me" ? fail(401, "unauthenticated") : ++providerCalls === 1 ? fail(503, "internal") : json({ providers: [] }));
    render(<AuthenticatedApp />);
    await screen.findByText("暂时无法读取登录方式，请重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("当前没有可用的登录方式。请联系部署管理员。");
    expect(screen.queryByRole("button", { name: /使用 .* 登录/ })).toBeNull();
  });

  it("retries an identity server failure without displaying projects or a signed-out state", async () => {
    let first = true;
    install((url) => { if (url === "/api/v1/me" && first) { first = false; return fail(500, "internal"); } return defaults(url); });
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "暂时无法确认登录状态" });
    expect(screen.queryByRole("heading", { name: "私有项目" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "私有项目" });
  });

  it("replaces the workspace when revalidation confirms a different identity and ignores late old data", async () => {
    let currentUser = user();
    let pendingProject!: (response: Response) => void;
    let pendingMe!: (response: Response) => void;
    let projectCalls = 0;
    const fetcher = vi.fn((url: string, _options?: RequestInit) => {
      if (url === "/api/v1/me") return currentUser.id === userId ? Promise.resolve(json(currentUser)) : new Promise<Response>((done) => { pendingMe = done; });
      if (url.startsWith("/api/v1/projects")) {
        projectCalls++;
        if (projectCalls === 1) return new Promise<Response>((done) => { pendingProject = done; });
        return Promise.resolve(json({ items: [project("Bob 的项目")], nextCursor: null }));
      }
      return Promise.resolve(defaults(url));
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AuthenticatedApp />);
    await screen.findByRole("link", { name: "账户设置：Alice" });
    const oldSignal = fetcher.mock.calls.find(([url]) => url.startsWith("/api/v1/projects"))![1] as RequestInit | undefined;
    currentUser = user(otherId, "Bob");
    fireEvent(window, new Event("focus"));
    expect(screen.queryByRole("link", { name: "账户设置：Alice" })).toBeNull();
    expect(document.body).toHaveClass("auth-session-checking");
    await act(async () => pendingMe(json(currentUser)));
    await screen.findByRole("heading", { name: "Bob 的项目" });
    await act(async () => pendingProject(json({ items: [project("Alice 的旧项目")], nextCursor: null })));
    expect(screen.queryByRole("heading", { name: "Alice 的旧项目" })).toBeNull();
    expect(screen.getByRole("link", { name: "账户设置：Bob" })).toBeInTheDocument();
    expect(oldSignal?.signal?.aborted).toBe(true);
  });

  it("keeps a one-time PAT reveal mounted through same-user focus revalidation", async () => {
    window.history.replaceState(null, "", "/account");
    let meCalls = 0;
    let finishCheck!: (response: Response) => void;
    const fetcher = vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/v1/me") { meCalls++; return meCalls === 1 ? Promise.resolve(json(user())) : new Promise<Response>((done) => { finishCheck = done; }); }
      if (url === "/api/v1/me/tokens") return Promise.resolve(options?.method === "POST"
        ? json({ id: otherId, name: "Device", createdAt: now, expiresAt: "2099-10-22T10:00:00Z", token: "once-only-secret" }, 201)
        : json({ items: [] }));
      return Promise.resolve(defaults(url));
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole("button", { name: "访问令牌" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "创建令牌" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
    fireEvent.change(screen.getByLabelText(/令牌名称/), { target: { value: "Device" } });
    fireEvent.submit(document.getElementById("create-token-form")!);
    const reveal = await screen.findByRole("dialog", { name: "访问令牌已创建" });
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(meCalls).toBe(2));
    expect(document.body).toHaveClass("auth-session-checking");
    expect(reveal.isConnected).toBe(true);
    await act(async () => finishCheck(fail(503, "internal")));
    expect(document.body).toHaveClass("auth-session-checking");
    const overlay = screen.getByRole("dialog", { name: "重新确认当前账户" });
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(screen.queryByText("关闭后无法恢复这份令牌。请确认你已保存。")).toBeNull();
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(overlay, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(reveal.isConnected).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新确认账户" }));
    await waitFor(() => expect(meCalls).toBe(3));
    await act(async () => finishCheck(json(user())));
    expect(document.body).not.toHaveClass("auth-session-checking");
    expect(screen.getByRole("dialog", { name: "访问令牌已创建" })).toBe(reveal);
    expect(screen.getByLabelText("一次性访问令牌")).toHaveValue("once-only-secret");
    expect(document.activeElement).toBe(screen.getByLabelText("一次性访问令牌"));
  });

  it("preserves a pending project creation on same-user focus and surfaces revalidation failure", async () => {
    let complete!: (response: Response) => void;
    let meCalls = 0;
    const fetcher = vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/v1/me") return Promise.resolve(++meCalls === 2 ? fail(503, "internal") : json(user()));
      if (url === "/api/v1/projects" && options?.method === "POST") return new Promise<Response>((done) => { complete = done; });
      return Promise.resolve(defaults(url));
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole("button", { name: "＋ 创建项目" }));
    fireEvent.change(screen.getByLabelText(/项目名称/), { target: { value: "Pending" } });
    fireEvent.change(screen.getByLabelText(/仓库地址/), { target: { value: "git@github.com:example/repo.git" } });
    fireEvent.submit(screen.getByRole("button", { name: "创建项目" }).closest("form")!);
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const dialog = screen.getByRole("dialog", { name: "创建私有项目" });
    const signal = fetcher.mock.calls.find(([, options]) => options?.method === "POST")![1]!.signal!;
    fireEvent(window, new Event("focus"));
    await screen.findByRole("heading", { name: "暂时无法重新确认当前账户" });
    expect(document.body).toHaveClass("auth-session-checking");
    expect(screen.queryByRole("dialog", { name: "创建私有项目" })).toBeNull();
    expect(dialog.isConnected).toBe(true);
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "重新确认账户" }));
    await waitFor(() => expect(meCalls).toBe(3));
    await waitFor(() => expect(document.body).not.toHaveClass("auth-session-checking"));
    expect(screen.getByRole("dialog", { name: "创建私有项目" })).toBe(dialog);
    await act(async () => complete(json(project(), 201)));
    await screen.findByRole("heading", { name: "私有项目" });
  });

  it("drops private project navigation context when another account is confirmed", async () => {
    window.history.replaceState(null, "", `/projects/${projectId}`);
    let switched = false;
    install((url) => {
      if (url === "/api/v1/me") return json(switched ? user(otherId, "Bob") : user());
      if (switched && url.endsWith("/members")) return fail(404, "not_found");
      return defaults(url);
    });
    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole("link", { name: "项目成员" }));
    await screen.findByRole("heading", { name: "项目成员" });
    expect(document.body.textContent).toContain("私有项目");
    switched = true;
    fireEvent(window, new Event("focus"));
    await screen.findByRole("link", { name: "账户设置：Bob" });
    await waitFor(() => expect(document.body.textContent).not.toContain("私有项目"));
    expect(document.body.textContent).not.toContain("私有项目");
  });

  it("clears all workspace data on a real resource401 while keeping project404 local", async () => {
    window.history.replaceState(null, "", `/projects/${projectId}`);
    let denied = false;
    install((url) => url.endsWith("/task-graph") && denied ? fail(404, "not_found") : defaults(url));
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "私有项目" });
    denied = true;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("heading", { name: "项目不存在" });
    expect(screen.getByRole("link", { name: "账户设置：Alice" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "私有项目" })).toBeNull();
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.endsWith("/task-graph") ? fail(401, "unauthenticated") : defaults(url))));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "登录你的工作空间" });
    expect(screen.getByText("登录状态已过期。重新登录后可继续访问项目。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "账户设置：Alice" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "项目不存在" })).toBeNull();
  });

  it("clears projects immediately when logout fails and offers an explicit retry", async () => {
    let failed = true;
    install((url) => url === "/api/v1/auth/logout" ? failed ? fail(503, "internal") : new Response(null, { status: 204 }) : defaults(url));
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "私有项目" });
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(screen.queryByRole("heading", { name: "私有项目" })).toBeNull();
    failed = false;
    fireEvent.click(await screen.findByRole("button", { name: "重试退出登录" }));
    await screen.findByRole("heading", { name: "登录你的工作空间" });
  });

  it("clears the workspace and stops automatic graph reads after a resource401", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", `/projects/${projectId}`);
    let expired = false;
    const fetcher = install((url) => expired && url.endsWith("/task-graph") ? fail(401, "unauthenticated") : defaults(url));
    await act(async () => { render(<AuthenticatedApp />); });
    expect(screen.getByRole("heading", { name: "私有项目" })).toBeInTheDocument();
    expired = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByRole("heading", { name: "登录你的工作空间" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "私有项目" })).toBeNull();
    const graphReads = () => fetcher.mock.calls.filter(([url]) => url.endsWith("/task-graph")).length;
    expect(graphReads()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(graphReads()).toBe(2);
  });

  it("shows project membership access from the authoritative current membership", async () => {
    window.history.replaceState(null, "", `/projects/${projectId}`);
    install((url) => url.endsWith("/members") ? json({ items: [member(userId, "member")] }) : defaults(url));
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "私有项目" });
    expect(await screen.findByText("成员", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "项目成员" })).toHaveAttribute("href", `/projects/${projectId}/members`);
  });

  it("handles valid account, membership and malformed routes", () => {
    expect(parseAuthRoute("/account")).toEqual({ kind: "account" });
    expect(parseAuthRoute(`/projects/${projectId}/members`)).toEqual({ kind: "members", projectId });
    expect(parseAuthRoute("/projects/%E0%A4%A")).toEqual({ kind: "notFound" });
    expect(parseAuthRoute("/projects/no/members")).toEqual({ kind: "notFound" });
    expect(parseAuthRoute("/unknown")).toEqual({ kind: "notFound" });
  });
});

describe("invitation handoff", () => {
  it("clears the fragment before any fetch and only accepts after explicit confirmation", async () => {
    window.history.replaceState(null, "", "/invitations#secret-one");
    const fetcher = vi.fn((url: string, options?: RequestInit) => {
      expect(window.location.hash).toBe("");
      if (url === "/api/v1/invitations/inspect") return Promise.resolve(json({ projectId, projectName: "受邀项目" }));
      if (url === "/api/v1/invitations/accept") return Promise.resolve(json(member()));
      return Promise.resolve(defaults(url));
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "受邀项目" });
    expect(window.sessionStorage.getItem(invitationStorageKey)).toBe("secret-one");
    expect(fetcher.mock.calls.some(([url]) => url.includes("accept"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "接受邀请并加入" }));
    await screen.findByRole("heading", { name: "私有项目" });
    const accept = fetcher.mock.calls.find(([url]) => url.endsWith("/accept"))!;
    expect(accept[1]?.body).toBe('{"token":"secret-one"}');
    expect(window.location.pathname).toBe(`/projects/${projectId}`);
    expect(window.sessionStorage.getItem(invitationStorageKey)).toBeNull();
    expect(document.body.textContent).not.toContain("secret-one");
  });

  it.each(["hashchange", "popstate"])("captures a second invitation synchronously on %s and cancels prior acceptance", async (eventName) => {
    window.history.replaceState(null, "", "/invitations#first-secret");
    let finishOld!: (response: Response) => void;
    const fetcher = vi.fn((url: string, options?: RequestInit) => {
      const body = options?.body === undefined ? null : JSON.parse(String(options.body)) as { token: string };
      if (url.endsWith("/inspect")) return Promise.resolve(json({ projectId, projectName: body?.token === "first-secret" ? "第一个项目" : "第二个项目" }));
      if (url.endsWith("/accept")) return body?.token === "first-secret" ? new Promise<Response>((done) => { finishOld = done; }) : Promise.resolve(json(member()));
      return Promise.resolve(defaults(url));
    });
    vi.stubGlobal("fetch", fetcher);
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "第一个项目" });
    fireEvent.click(screen.getByRole("button", { name: "接受邀请并加入" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith("/accept"))).toBe(true));
    const previousSignal = fetcher.mock.calls.find(([url]) => url.endsWith("/accept"))![1]!.signal!;
    window.history.pushState(null, "", "/invitations#second-secret");
    fireEvent(window, new Event(eventName));
    expect(window.location.hash).toBe("");
    expect(previousSignal.aborted).toBe(true);
    await screen.findByRole("heading", { name: "第二个项目" });
    await act(async () => finishOld(json(member())));
    expect(window.location.pathname).toBe("/invitations");
    expect(screen.getByRole("heading", { name: "第二个项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "接受邀请并加入" }));
    await screen.findByRole("heading", { name: "私有项目" });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/accept")).map(([, options]) => options?.body)).toEqual(['{"token":"first-secret"}', '{"token":"second-secret"}']);
  });

  it("restores the tab invitation after login, supports cancellation, and drops unavailable secrets", async () => {
    window.sessionStorage.setItem(invitationStorageKey, "secret-persisted");
    window.history.replaceState(null, "", "/invitations");
    install((url) => url.endsWith("/inspect") ? json({ projectId, projectName: "待确认项目" }) : defaults(url));
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "待确认项目" });
    fireEvent.click(screen.getByRole("button", { name: "暂不加入" }));
    await screen.findByRole("heading", { name: "私有项目" });
    expect(window.sessionStorage.getItem(invitationStorageKey)).toBeNull();
  });

  it("shows unavailable invitations without leaking or retaining their secret", async () => {
    window.history.replaceState(null, "", "/invitations#expired-secret");
    install((url) => url.endsWith("/inspect") ? fail(410, "invitation_unavailable") : defaults(url));
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "邀请已不可用" });
    expect(window.sessionStorage.getItem(invitationStorageKey)).toBeNull();
    expect(document.body.textContent).not.toContain("expired-secret");
    expect(document.body.textContent).not.toContain("hidden server details");
  });

  it("does not consume an invitation for an existing member", async () => {
    window.history.replaceState(null, "", "/invitations#existing-secret");
    const fetcher = install((url) => url.endsWith("/inspect") ? json({ projectId, projectName: "受邀项目", member: member() }) : defaults(url));
    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole("button", { name: "打开项目" }));
    await screen.findByRole("heading", { name: "私有项目" });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/accept"))).toBe(false);
  });

  it("erases a retained invitation value when removeItem is unavailable", async () => {
    window.history.replaceState(null, "", "/invitations#cleanup-secret");
    install((url) => url.endsWith("/inspect") ? json({ projectId, projectName: "受邀项目" }) : defaults(url));
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "受邀项目" });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked removal"); });
    fireEvent.click(screen.getByRole("button", { name: "暂不加入" }));
    await screen.findByRole("heading", { name: "私有项目" });
    expect(window.sessionStorage.getItem(invitationStorageKey)).toBe("");
    expect(document.body.textContent).not.toContain("cleanup-secret");
  });

  it("exposes a blocked terminal cleanup while clearing the in-memory invitation", async () => {
    window.history.replaceState(null, "", "/invitations#blocked-secret");
    install((url) => url.endsWith("/inspect") ? json({ projectId, projectName: "受邀项目" }) : defaults(url));
    render(<AuthenticatedApp />);
    await screen.findByRole("heading", { name: "受邀项目" });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked removal"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked writes"); });
    fireEvent.click(screen.getByRole("button", { name: "暂不加入" }));
    await screen.findByRole("heading", { name: "私有项目" });
    expect(screen.getByText("浏览器无法清除邀请临时数据。请关闭此标签页以清除邀请。")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("blocked-secret");
  });

  it("reports storage restrictions while preserving a clean login return URL", async () => {
    window.history.replaceState(null, "", "/invitations#tab-secret");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked"); });
    install((url) => url === "/api/v1/me" ? fail(401, "unauthenticated") : defaults(url));
    const login = vi.fn();
    render(<AuthenticatedApp navigateToLogin={login} />);
    fireEvent.click(await screen.findByRole("button", { name: "使用 GitHub 登录" }));
    expect(screen.getByText("浏览器无法保存邀请。登录后请重新打开邀请链接。")).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith("/api/v1/auth/login?provider=github&returnPath=%2Finvitations");
    expect(window.location.hash).toBe("");
  });
});

describe("private project creation", () => {
  it("submits required fields, navigates to the created project, and restores native dialog cancellation", async () => {
    const fetcher = vi.fn((url: string, options?: RequestInit) => Promise.resolve(url === "/api/v1/projects" && options?.method === "POST" ? json(project("新项目"), 201) : defaults(url)));
    vi.stubGlobal("fetch", fetcher);
    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole("button", { name: "＋ 创建项目" }));
    const dialog = screen.getByRole("dialog", { name: "创建私有项目" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "项目名称 *" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "＋ 创建项目" }));
    fireEvent.change(screen.getByLabelText(/项目名称/), { target: { value: "  新项目  " } });
    const repository = screen.getByLabelText(/仓库地址/) as HTMLInputElement;
    expect(repository.checkValidity()).toBe(false);
    fireEvent.change(repository, { target: { value: "git@github.com:example/repo.git" } });
    expect(repository.checkValidity()).toBe(true);
    fireEvent.submit(screen.getByRole("button", { name: "创建项目" }).closest("form")!);
    await waitFor(() => expect(window.location.pathname).toBe(`/projects/${projectId}`));
    expect(fetcher.mock.calls.find(([, options]) => options?.method === "POST")?.[1]?.body).toBe('{"name":"新项目","repoUrl":"git@github.com:example/repo.git"}');
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a failed submission recoverable and handles whitespace input without an unhandled rejection", async () => {
    install();
    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole("button", { name: "＋ 创建项目" }));
    fireEvent.change(screen.getByLabelText(/项目名称/), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/仓库地址/), { target: { value: "https://github.com/example/repo" } });
    fireEvent.submit(screen.getByRole("button", { name: "创建项目" }).closest("form")!);
    await screen.findByText("项目创建失败，请检查输入后重试。");
    expect(screen.getByRole("button", { name: "创建项目" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
