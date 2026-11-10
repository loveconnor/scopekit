import type { DeviceType } from "@scopekit/contracts";

/**
 * Documented bot filter: user agents that identify themselves as automation, link previews,
 * monitors or HTTP libraries. Some bots still get through and some real browsers never load
 * the script, so analytics remains an estimate of instrumented traffic.
 */
export const BOT_PATTERN =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptime|monitor|scrape|preview|curl|wget|python|axios|node-fetch|undici|go-http|okhttp|java\/|phantomjs|puppeteer|playwright|selenium|webdriver|gtmetrix|facebookexternalhit|whatsapp|telegram|discord|embedly|inspectiontool|feedfetcher|validator/i;

export type ParsedUserAgent = { deviceType: DeviceType; browserFamily: string; isBot: boolean };

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua || ua.length < 12) return { deviceType: "unknown", browserFamily: "Unknown", isBot: true };
  const isBot = BOT_PATTERN.test(ua);

  let deviceType: DeviceType = "desktop";
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobi)/i.test(ua)) deviceType = "tablet";
  else if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) deviceType = "mobile";

  let browserFamily = "Other";
  if (/Edg(e|A|iOS)?\//.test(ua)) browserFamily = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browserFamily = "Opera";
  else if (/SamsungBrowser\//.test(ua)) browserFamily = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//.test(ua)) browserFamily = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browserFamily = "Chrome";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browserFamily = "Safari";

  return { deviceType, browserFamily, isBot };
}
