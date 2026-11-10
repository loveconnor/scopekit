/** The install snippet for a site. Plain text, so server and client components can both build it. */
export function buildSnippet(opts: { collectorUrl: string; publicId: string; consent: boolean; queryParams: string[] }): string {
  const attrs = [
    "  defer",
    `  src="${opts.collectorUrl}/script.js"`,
    `  data-site="${opts.publicId}"`,
    ...(opts.consent ? ['  data-mode="consent"'] : []),
    ...(opts.queryParams.length ? [`  data-query="${opts.queryParams.join(",")}"`] : []),
  ];
  return `<script\n${attrs.join("\n")}\n></script>`;
}
