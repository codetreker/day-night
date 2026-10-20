import { isIP, SocketAddress } from "node:net";

export class RepositoryIdentityError extends Error {
  constructor(readonly reason: string, options?: ErrorOptions) {
    super(`Invalid repository address: ${reason}. Expected an HTTPS, SSH, or SCP repository address.`, options);
    this.name = "RepositoryIdentityError";
  }
}

const invalid = (reason: string): never => { throw new RepositoryIdentityError(reason); };
const control = /\p{Cc}/u;
const forbiddenText = /[\p{White_Space}\p{Cc}]/u;
const hostCharacters = /^[\p{L}\p{N}\-._~!$&'()*+,;=]+$/u;

const unescape = (value: string): string => {
  try { return decodeURIComponent(value); }
  catch (cause) { throw new RepositoryIdentityError("invalid UTF-8 or percent encoding", { cause }); }
};

const hostIdentity = (host: string, bracketed: boolean): string => {
  const ip = host.includes("%") ? 0 : isIP(host);
  if (bracketed && ip === 0) return invalid("brackets require an IP address");
  if (ip === 6) return `[${new SocketAddress({ address: host, port: 0, family: "ipv6" }).address}]`;
  if (!hostCharacters.test(host)) return invalid("invalid host");
  return host.toLowerCase();
};

const pathIdentity = (path: string): string => {
  const trimmed = path.replace(/\/+$/, "");
  const withoutSuffix = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
  return withoutSuffix.replaceAll("/", "") === "" ? trimmed : withoutSuffix;
};

const ordinaryPath = (path: string): boolean => !path.startsWith("~") && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const urlIdentity = (input: string): string => {
  const match = /^(https|ssh):\/\/([^/]*)(\/.*)$/i.exec(input);
  if (match === null) return invalid("invalid URL scheme, authority, or repository path");
  const scheme = match[1]!.toLowerCase();
  let authority = match[2]!;
  const rawPath = match[3]!;
  if (unescape(rawPath).replaceAll("/", "") === "") return invalid("repository path is empty");
  let user: string | undefined;
  const at = authority.lastIndexOf("@");
  if (at >= 0) {
    user = authority.slice(0, at);
    authority = authority.slice(at + 1);
    if (scheme === "https" || user === "" || user.includes(":")) return invalid("credentials or an empty SSH user are forbidden");
    if (!/^[A-Za-z0-9\-._~!$&'()*+,;=%@]+$/.test(user)) return invalid("invalid SSH user");
    if (unescape(user) === "") return invalid("SSH user is empty");
  }
  let rawHost: string;
  let portText: string | undefined;
  let bracketed = false;
  if (authority.startsWith("[")) {
    bracketed = true;
    const end = authority.indexOf("]");
    if (end < 0) return invalid("invalid bracketed host");
    rawHost = authority.slice(1, end);
    const suffix = authority.slice(end + 1);
    if (suffix !== "") {
      if (!suffix.startsWith(":")) return invalid("invalid host suffix");
      portText = suffix.slice(1);
    }
  } else {
    const colon = authority.lastIndexOf(":");
    rawHost = colon < 0 ? authority : authority.slice(0, colon);
    if (colon >= 0) portText = authority.slice(colon + 1);
    if (scheme === "https" && rawHost.includes(":")) return invalid("IPv6 HTTPS hosts require brackets");
  }
  if (rawHost.includes("%") && /%(?:[0-7][0-9a-f])/i.test(rawHost.replaceAll(/%25/gi, ""))) return invalid("ASCII host escapes are forbidden");
  const host = unescape(rawHost);
  // Go URL authorities permit bracketed IPv6; SCP additionally permits bracketed IPv4.
  if (bracketed && isIP(host) !== 6) return invalid("URL brackets require IPv6");
  const normalizedHost = hostIdentity(host, bracketed);
  let port: number | undefined;
  if (portText !== undefined) {
    if (!/^[0-9]+$/.test(portText)) return invalid("invalid port");
    port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return invalid("port must be from 1 to 65535");
  }
  const defaultPort = scheme === "https" ? 443 : 22;
  const normalizedPort = port === undefined || port === defaultPort ? "" : `:${port}`;
  const path = pathIdentity(rawPath);
  const relativePath = path.slice(1);
  if (normalizedPort === "" && (scheme === "https" || user === "git") && ordinaryPath(relativePath)) return `${normalizedHost}/${relativePath}`;
  return `${scheme}://${user === undefined ? "" : `${user}@`}${normalizedHost}${normalizedPort}${path}`;
};

const scpIdentity = (input: string): string => {
  let delimiter = input.indexOf(":");
  const opening = input.indexOf("[");
  if (opening >= 0 && opening < delimiter) {
    const end = input.indexOf("]:");
    if (end < 0) return invalid("invalid bracketed SCP host");
    delimiter = end + 1;
  }
  if (delimiter < 0) return invalid("SCP address requires a host and path");
  const authority = input.slice(0, delimiter);
  const rawPath = input.slice(delimiter + 1);
  if (rawPath.replaceAll("/", "") === "") return invalid("repository path is empty");
  const at = authority.indexOf("@");
  let user: string | undefined;
  let host: string;
  if (at >= 0) {
    user = authority.slice(0, at);
    host = authority.slice(at + 1);
    if (user === "" || /[:/\[\]]/.test(user)) return invalid("invalid SCP user");
  } else {
    host = authority;
    const firstPathComponent = rawPath.split("/", 1)[0]!;
    const pathAt = firstPathComponent.indexOf("@");
    if (pathAt >= 0 && firstPathComponent.slice(pathAt + 1).includes(":")) return invalid("ambiguous SCP credentials");
  }
  const bracketed = host.startsWith("[") && host.endsWith("]");
  const normalizedHost = hostIdentity(bracketed ? host.slice(1, -1) : host, bracketed);
  const path = pathIdentity(rawPath);
  if (user === "git" && ordinaryPath(path)) return `${normalizedHost}/${path}`;
  return `scp://${user === undefined ? "" : `${user}@`}${normalizedHost}:${path}`;
};

export const repositoryIdentity = (input: string): string => {
  if (input === "" || !input.isWellFormed() || forbiddenText.test(input)) return invalid("empty or invalid repository text");
  const decoded = unescape(input);
  if (control.test(decoded)) return invalid("encoded control characters are forbidden");
  if (/[?#]/.test(input)) return invalid("query and fragment are forbidden");
  return input.includes("://") ? urlIdentity(input) : scpIdentity(input);
};
