const proxyNames = new Set(["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]);

export const claudeProviderEnvironment = (
  settings: Readonly<Record<string, unknown>>,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  // Claude applies these proxy variables to custom provider requests as well as first-party requests.
  // https://code.claude.com/docs/en/network-config
  for (const source of [settings, inherited]) {
    for (const [name, value] of Object.entries(source)) {
      if ((name.startsWith("ANTHROPIC_") || proxyNames.has(name)) && typeof value === "string") environment[name] = value;
    }
  }
  return environment;
};

export const assertClaudeProxyEnvironment = (environment: NodeJS.ProcessEnv): void => {
  for (const [name, value] of Object.entries(environment)) {
    if (!proxyNames.has(name) || /no_proxy/i.test(name) || value === undefined || value === "") continue;
    if (!URL.canParse(value)) throw new Error(`Claude native acceptance requires a valid ${name} URL.`);
    const proxy = new URL(value);
    if (proxy.username !== "" || proxy.password !== "") {
      throw new Error(`Claude native acceptance does not support credentials in ${name}: native subprocess scrubbing preserves proxy credentials.`);
    }
  }
};
