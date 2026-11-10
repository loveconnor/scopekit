export type RobotsRule = { allow: boolean; pattern: string; regex: RegExp };
export type Robots = { groups: { agents: string[]; rules: RobotsRule[] }[]; sitemaps: string[] };

const toRegex = (pattern: string) => {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
};

/** Parses robots.txt the way Google documents it: groups by user agent, longest matching rule wins. */
export function parseRobots(text: string): Robots {
  const robots: Robots = { groups: [], sitemaps: [] };
  let current: Robots["groups"][number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "sitemap") {
      if (value) robots.sitemaps.push(value);
    } else if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        robots.groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      lastWasAgent = false;
      // An empty Disallow means nothing is disallowed.
      if (value) current.rules.push({ allow: field === "allow", pattern: value, regex: toRegex(value) });
    } else {
      lastWasAgent = false;
    }
  }
  return robots;
}

/** Whether `path` (with query) may be fetched. Rules for our own agent replace the `*` group, as the standard says. */
export function isAllowedByRobots(robots: Robots, path: string, agent = "scopekitbot"): boolean {
  const own = robots.groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const groups = own.length ? own : robots.groups.filter((g) => g.agents.includes("*"));
  let best: RobotsRule | null = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!rule.regex.test(path)) continue;
      if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
    }
  }
  return best ? best.allow : true;
}
