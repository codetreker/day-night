import { ApiError, json, read, request, requestId } from "./client";
import { decodeAuthJson, parseAuthConfig, parseCreatedInvitation, parseCreatedToken, parseInvitationInspection, parseInvitations, parseMember, parseMembers, parseMemberVersion, parseRole, parseTokens, parseUser } from "./auth-parse";
import { project } from "./parse";
import type { AuthConfig, CreatedPersonalAccessToken, CreatedProjectInvitation, PersonalAccessToken, ProjectInvitation, ProjectInvitationInspection, ProjectMember, ProjectRole, User } from "./auth-types";
import type { Project } from "./types";
export type * from "./auth-types";

const send = async <T>(url: string, method: "POST" | "PATCH", status: number, body: string, signal: AbortSignal, parse: (data: unknown) => T): Promise<T> => {
  const response = await request(url, signal, { method, body, headers: { Accept: "application/json", "Content-Type": "application/json" } });
  return json(response, signal, (data) => {
    if (response.status !== status) throw new ApiError("protocol", response.status);
    return parse(data);
  }, decodeAuthJson);
};

const empty = async (url: string, method: "POST" | "DELETE", signal: AbortSignal, body?: string): Promise<void> => {
  const response = await request(url, signal, { method, ...(body === undefined ? {} : { body, headers: { "Content-Type": "application/json" } }) });
  if (!response.ok) return json(response, signal, () => { throw new ApiError("protocol", response.status); });
  if (response.status !== 204) throw new ApiError("protocol", response.status);
};
const projectUrl = (projectId: string): string => `/api/v1/projects/${requestId(projectId)}`;
const secretBody = (token: string): string => {
  if (token === "" || /[\s\p{Cc}\p{Cs}]/u.test(token)) throw new ApiError("protocol");
  return JSON.stringify({ token });
};

export const me = (signal: AbortSignal): Promise<User> => read("/api/v1/me", signal, parseUser);
export const getAuthConfig = (signal: AbortSignal): Promise<AuthConfig> => read("/api/v1/auth/providers", signal, parseAuthConfig);
export const logout = (signal: AbortSignal): Promise<void> => empty("/api/v1/auth/logout", "POST", signal);
export const listTokens = (signal: AbortSignal): Promise<readonly PersonalAccessToken[]> => read("/api/v1/me/tokens", signal, parseTokens);
export const createToken = (input: { readonly name: string; readonly days?: number }, signal: AbortSignal): Promise<CreatedPersonalAccessToken> => {
  if (input.name.trim() === "" || [...input.name].length > 100 || /[\u0000\p{Cs}]/u.test(input.name) || (input.days !== undefined && (!Number.isInteger(input.days) || input.days < 1 || input.days > 365))) throw new ApiError("protocol");
  return send("/api/v1/me/tokens", "POST", 201, JSON.stringify(input), signal, parseCreatedToken);
};
export const revokeToken = (tokenId: string, signal: AbortSignal): Promise<void> => empty(`/api/v1/me/tokens/${requestId(tokenId)}`, "DELETE", signal);

export const createProject = (input: { readonly name: string; readonly repoUrl: string }, signal: AbortSignal): Promise<Project> => {
  if (input.name.trim() === "" || input.repoUrl.trim() === "" || input.name.includes("\0") || input.repoUrl.includes("\0")) throw new ApiError("protocol");
  return send("/api/v1/projects", "POST", 201, JSON.stringify(input), signal, project);
};
export const listMembers = (projectId: string, signal: AbortSignal): Promise<readonly ProjectMember[]> => {
  const project = requestId(projectId);
  return read(`${projectUrl(project)}/members`, signal, (data) => parseMembers(data, project), decodeAuthJson);
};
export const setMemberRole = (projectId: string, userId: string, input: { readonly version: bigint; readonly role: ProjectRole }, signal: AbortSignal): Promise<ProjectMember> => {
  const project = requestId(projectId), user = requestId(userId);
  const version = parseMemberVersion(input.version), role = parseRole(input.role);
  return send(`${projectUrl(project)}/members/${user}`, "PATCH", 200, `{"version":${version},"role":${JSON.stringify(role)}}`, signal, (data) => parseMember(data, project, user));
};
export const removeMember = (projectId: string, userId: string, version: bigint, signal: AbortSignal): Promise<void> =>
  empty(`${projectUrl(projectId)}/members/${requestId(userId)}`, "DELETE", signal, `{"version":${parseMemberVersion(version)}}`);

export const listInvitations = (projectId: string, signal: AbortSignal): Promise<readonly ProjectInvitation[]> => {
  const project = requestId(projectId);
  return read(`${projectUrl(project)}/invitations`, signal, (data) => parseInvitations(data, project));
};
export const createInvitation = (projectId: string, signal: AbortSignal): Promise<CreatedProjectInvitation> => {
  const project = requestId(projectId);
  return send(`${projectUrl(project)}/invitations`, "POST", 201, "{}", signal, (data) => parseCreatedInvitation(data, project));
};
export const revokeInvitation = (projectId: string, invitationId: string, signal: AbortSignal): Promise<void> =>
  empty(`${projectUrl(projectId)}/invitations/${requestId(invitationId)}`, "DELETE", signal);
export const inspectInvitation = (token: string, signal: AbortSignal): Promise<ProjectInvitationInspection> =>
  send("/api/v1/invitations/inspect", "POST", 200, secretBody(token), signal, parseInvitationInspection);
export const acceptInvitation = (token: string, signal: AbortSignal): Promise<ProjectMember> =>
  send("/api/v1/invitations/accept", "POST", 200, secretBody(token), signal, parseMember);
