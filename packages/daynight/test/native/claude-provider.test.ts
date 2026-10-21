import { describe, expect, it } from "vitest";
import { assertClaudeProxyEnvironment, claudeProviderEnvironment } from "./claude-provider.js";

describe("Claude native provider projection", () => {
  it("preserves inherited provider and case-sensitive proxy precedence without unrelated operator state", () => {
    expect(claudeProviderEnvironment({
      ANTHROPIC_AUTH_TOKEN: "settings-bearer", ANTHROPIC_BASE_URL: "https://provider.example",
      HTTPS_PROXY: "http://settings-proxy.example", http_proxy: "http://settings-http.example",
      NO_PROXY: "localhost", CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", ignored: true,
    }, {
      ANTHROPIC_AUTH_TOKEN: "inherited-bearer", HTTPS_PROXY: "http://operator-proxy.example",
      https_proxy: "http://lowercase-proxy.example", HTTP_PROXY: "http://operator-http.example",
      no_proxy: "127.0.0.1", HOME: "/operator", GH_TOKEN: "unrelated-credential",
    })).toEqual({
      ANTHROPIC_AUTH_TOKEN: "inherited-bearer", ANTHROPIC_BASE_URL: "https://provider.example",
      HTTPS_PROXY: "http://operator-proxy.example", https_proxy: "http://lowercase-proxy.example",
      HTTP_PROXY: "http://operator-http.example", http_proxy: "http://settings-http.example",
      NO_PROXY: "localhost", no_proxy: "127.0.0.1",
    });
  });

  it("rejects proxy userinfo without disclosing its values before native execution", () => {
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
      for (const proxy of ["http://synthetic-user@proxy.example", "http://:synthetic%2Fpassword@proxy.example"]) {
        expect(() => assertClaudeProxyEnvironment({ [name]: proxy })).toThrow(`Claude native acceptance does not support credentials in ${name}: native subprocess scrubbing preserves proxy credentials.`);
      }
    }
  });

  it("accepts plain or disabled proxies and rejects malformed URLs without echoing their input", () => {
    expect(() => assertClaudeProxyEnvironment({ HTTP_PROXY: "http://proxy.example", HTTPS_PROXY: "", NO_PROXY: "localhost,127.0.0.1" })).not.toThrow();
    expect(() => assertClaudeProxyEnvironment({ HTTPS_PROXY: "invalid-proxy" })).toThrow("Claude native acceptance requires a valid HTTPS_PROXY URL.");
  });
});
