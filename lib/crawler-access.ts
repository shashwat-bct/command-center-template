export const AI_BOTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Googlebot", "ClaudeBot",
  "Claude-SearchBot", "Claude-User", "anthropic-ai", "Bingbot", "Applebot-Extended", "meta-externalagent", "Meta-ExternalFetcher",
  "Amazonbot", "Bytespider", "CCBot", "cohere-ai", "DuckAssistBot", "YouBot", "MistralAI-User", "Grok", "xAI",
] as const;

export type BotAccess = { state: "open" | "partial" | "blocked" | "unknown"; explicit: boolean; rule: string };
export type CrawlerSite = { host: string; kind: string; fetched: "direct" | "failed"; llmsTxt: boolean; note: string | null; bots: Record<string, BotAccess> };
export type CrawlerAccess = { capturedAt: string; bots: string[]; sites: CrawlerSite[] };

type Group = { agents: string[]; allow: string[]; disallow: string[] };

/**
 * Splits a robots.txt into user-agent groups with their allow and disallow
 * paths.
 */
export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  return groups;
}

/**
 * What a robots.txt lets one crawler read: blocked when the site root is
 * disallowed with nothing allowed back, partial when the root is disallowed
 * but some paths are allowed, open otherwise.
 */
export function botAccess(groups: Group[], bot: string): BotAccess {
  const own = groups.filter((g) => g.agents.includes(bot.toLowerCase()));
  const use = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  const allow = use.flatMap((g) => g.allow), disallow = use.flatMap((g) => g.disallow);
  const explicit = own.length > 0;
  if (disallow.includes("/")) {
    return allow.some((a) => a !== "/" && a.length > 1)
      ? { state: "partial", explicit, rule: "Disallow: / with allows" }
      : { state: "blocked", explicit, rule: "Disallow: /" };
  }
  return { state: "open", explicit, rule: disallow.length ? `${disallow.length} path rule${disallow.length === 1 ? "" : "s"}` : "no rules" };
}

async function fetchText(url: string): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; AtlasCrawlerAudit/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    return { ok: r.ok, text: r.ok ? await r.text() : "" };
  } catch {
    return { ok: false, text: "" };
  }
}

/**
 * Reads robots.txt and llms.txt for each site and records, per AI crawler,
 * whether it may read the site.
 */
export async function readCrawlerAccess(sites: Array<{ host: string; kind: string }>): Promise<CrawlerAccess> {
  const out = await Promise.all(sites.map(async ({ host, kind }): Promise<CrawlerSite> => {
    const [robots, llms] = await Promise.all([fetchText(`https://${host}/robots.txt`), fetchText(`https://${host}/llms.txt`)]);
    const groups = robots.ok ? parseRobots(robots.text) : [];
    const llmsTxt = llms.ok && llms.text.trim().length > 0 && !/^\s*</.test(llms.text);
    const bots = Object.fromEntries(AI_BOTS.map((b) => [b, robots.ok ? botAccess(groups, b) : { state: "unknown" as const, explicit: false, rule: "robots.txt not readable" }]));
    return { host, kind, fetched: robots.ok ? "direct" : "failed", llmsTxt, note: robots.ok ? null : "robots.txt could not be read from this server", bots };
  }));
  return { capturedAt: new Date().toISOString(), bots: [...AI_BOTS], sites: out };
}
