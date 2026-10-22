import { describe, expect, it } from "vitest";
import { parseServerConfiguration } from "../../src/config/server.js";
import { resolveConfigurationPaths } from "../../src/config/paths.js";
import { formatError } from "../../src/platform/diagnostics.js";

const paths = resolveConfigurationPaths("/home/config");
const configuration = (serverUrl: string, serverToken: unknown) =>
  JSON.stringify({ serverUrl, serverToken });

describe("server token configuration", () => {
  it("projects the optional token without changing its visible ASCII bytes", () => {
    const serverToken = "!Bearer-token_09.~+/=:AZaz";
    expect(parseServerConfiguration(configuration("https://service.example", serverToken), paths)).toEqual({
      serverUrl: "https://service.example", serverToken,
    });
  });

  it.each([undefined, null, false, 0, [], {}, "", " ", "secret token", " token", "token ", "tab\tsecret", "line\nsecret", "line\rsecret", "\u0000secret", "secret\u007f", "secret\u0080", "密钥"])("rejects a present invalid token without revealing it: %j", (serverToken) => {
    const source = serverToken === undefined ? "serverUrl: https://service.example\nserverToken:\n" : configuration("https://service.example", serverToken);
    try {
      parseServerConfiguration(source, paths);
      expect.unreachable("A present invalid token must fail.");
    } catch (cause) {
      const diagnostic = formatError(cause);
      expect(diagnostic).toContain(paths.configFile);
      expect(diagnostic).toContain("serverToken");
      if (typeof serverToken === "string" && serverToken.length > 1) expect(diagnostic).not.toContain(serverToken);
    }
  });

  it.each([
    "http://localhost:8787", "http://127.0.0.1:8787", "http://127.0.0.2", "http://127.255.255.254", "http://[::1]:8787", "http://[0:0:0:0:0:0:0:1]",
    "https://service.example", "https://localhost", "https://192.168.1.1", "https://[::ffff:127.0.0.1]",
  ])("accepts authenticated transport to %s", (serverUrl) => {
    expect(parseServerConfiguration(configuration(serverUrl, "test-secret"), paths)).toEqual({
      serverUrl: new URL(serverUrl).origin, serverToken: "test-secret",
    });
  });

  it.each([
    "http://localhost.localdomain", "http://service.example", "http://126.255.255.255", "http://128.0.0.1", "http://0.0.0.0", "http://192.168.1.1", "http://[::]", "http://[::2]", "http://[::ffff:127.0.0.1]",
  ])("rejects authenticated non-loopback HTTP transport to %s without revealing the token", (serverUrl) => {
    expect(() => parseServerConfiguration(configuration(serverUrl, "transport-secret"), paths)).toThrow("serverToken");
    try { parseServerConfiguration(configuration(serverUrl, "transport-secret"), paths); }
    catch (cause) { expect(formatError(cause)).not.toContain("transport-secret"); }
    expect(parseServerConfiguration(JSON.stringify({ serverUrl }), paths)).toEqual({ serverUrl: new URL(serverUrl).origin });
  });
});
