import { array, boolean, id, malformed, nonemptyString, record, string, timestamp } from "./parse";
import { parseApiJson } from "./json";
import type { AuthConfig, AuthProvider, CreatedPersonalAccessToken, CreatedProjectInvitation, PersonalAccessToken, ProjectInvitation, ProjectInvitationInspection, ProjectMember, ProjectRole, User } from "./auth-types";

const nullable = <T>(value: unknown, parse: (value: unknown) => T): T | null => value === null ? null : parse(value);
const unique = <T>(items: T[], key: (item: T) => string): T[] => {
  if (new Set(items.map(key)).size !== items.length) return malformed();
  return items;
};

export const parseRole = (value: unknown): ProjectRole => value === "admin" || value === "member" ? value : malformed();
export const parseMemberVersion = (value: unknown): bigint => {
  if (typeof value !== "bigint" || value < 1n || value > 9_223_372_036_854_775_807n) return malformed();
  return value;
};

export const parseAuthConfig = (value: unknown): AuthConfig => {
  const providers = array(record(value).providers, (provider): AuthProvider => {
    if (provider !== "microsoft" && provider !== "google" && provider !== "github") return malformed();
    return provider;
  });
  return { providers: unique(providers, (provider) => provider) };
};

const stringEnd = (text: string, start: number): number => {
  let offset = start + 1;
  while (text[offset] !== '"') offset += text[offset] === '\\' ? 2 : 1;
  return offset + 1;
};

// Native parsing validates the envelope before we split its direct values into source spans.
const containerSources = (text: string): string[] => {
  const source = text.trim();
  const values: string[] = [];
  let start = 1;
  let depth = 0;
  for (let offset = 1; offset < source.length; offset++) {
    const token = source[offset];
    if (token === '"') { offset = stringEnd(source, offset) - 1; continue; }
    if (token === '{' || token === '[') { depth++; continue; }
    if (token === '}' || token === ']') {
      if (depth > 0) { depth--; continue; }
      const value = source.slice(start, offset).trim();
      if (value !== '') values.push(value);
      return values;
    }
    if (token === ',' && depth === 0) { values.push(source.slice(start, offset).trim()); start = offset + 1; }
  }
  return values;
};

export const decodeAuthJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  const parsed = parseApiJson(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return parsed;
  const data = parsed as Record<string, unknown>;
  const fields = new Map(containerSources(text).map((field) => {
    const end = stringEnd(field, 0);
    return [JSON.parse(field.slice(0, end)) as string, field.slice(end).trimStart().slice(1)];
  }));
  // Only membership pages and invitation inspections embed versioned member DTOs.
  if (Object.hasOwn(data, 'items') && Array.isArray(data.items)) data.items = containerSources(fields.get('items')!).map(parseApiJson);
  if (Object.hasOwn(data, 'member')) data.member = parseApiJson(fields.get('member')!);
  return parsed;
};

export const parseUser = (value: unknown): User => {
  const data = record(value);
  return {
    id: id(data.id), email: nullable(data.email, string), emailVerified: nullable(data.emailVerified, boolean),
    name: nullable(data.name, string), avatarUrl: nullable(data.avatarUrl, string),
  };
};

export const parseToken = (value: unknown): PersonalAccessToken => {
  const data = record(value);
  return { id: id(data.id), name: nonemptyString(data.name), createdAt: timestamp(data.createdAt), expiresAt: timestamp(data.expiresAt) };
};
export const parseTokens = (value: unknown): PersonalAccessToken[] => unique(array(record(value).items, parseToken), (item) => item.id);
export const parseCreatedToken = (value: unknown): CreatedPersonalAccessToken => {
  const data = record(value);
  const token = string(data.token);
  if (!/^[\x21-\x7e]+$/.test(token)) return malformed();
  return { ...parseToken(data), token };
};

export const parseMember = (value: unknown, projectId?: string, userId?: string): ProjectMember => {
  const data = record(value);
  const member: ProjectMember = {
    projectId: id(data.projectId), userId: id(data.userId), email: nullable(data.email, string),
    name: nullable(data.name, string), avatarUrl: nullable(data.avatarUrl, string), role: parseRole(data.role),
    version: parseMemberVersion(data.version), createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt),
  };
  if ((projectId !== undefined && member.projectId !== projectId) || (userId !== undefined && member.userId !== userId)) return malformed();
  return member;
};
export const parseMembers = (value: unknown, projectId: string): ProjectMember[] =>
  unique(array(record(value).items, (item) => parseMember(item, projectId)), (item) => item.userId);

export const parseInvitation = (value: unknown, projectId?: string): ProjectInvitation => {
  const data = record(value);
  const invitation: ProjectInvitation = {
    id: id(data.id), projectId: id(data.projectId), createdBy: id(data.createdBy), createdAt: timestamp(data.createdAt), expiresAt: timestamp(data.expiresAt),
    consumedBy: nullable(data.consumedBy, id), consumedAt: nullable(data.consumedAt, timestamp), revokedAt: nullable(data.revokedAt, timestamp),
  };
  if (projectId !== undefined && invitation.projectId !== projectId) return malformed();
  return invitation;
};
export const parseInvitations = (value: unknown, projectId: string): ProjectInvitation[] =>
  unique(array(record(value).items, (item) => parseInvitation(item, projectId)), (item) => item.id);

export const parseCreatedInvitation = (value: unknown, projectId: string): CreatedProjectInvitation => {
  const data = record(value);
  const link = nonemptyString(data.link);
  let url: URL;
  try { url = new URL(link); } catch { return malformed(); }
  if (url.origin !== window.location.origin || url.pathname !== "/invitations" || url.search !== "" || url.username !== "" || url.password !== "" || url.hash.length < 2 || /[\s\p{Cc}]/u.test(link)) return malformed();
  return { ...parseInvitation(data, projectId), link };
};

export const parseInvitationInspection = (value: unknown): ProjectInvitationInspection => {
  const data = record(value);
  const projectId = id(data.projectId);
  return {
    projectId, projectName: nonemptyString(data.projectName),
    ...(Object.hasOwn(data, "member") ? { member: parseMember(data.member, projectId) } : {}),
  };
};
