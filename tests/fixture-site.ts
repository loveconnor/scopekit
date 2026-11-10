/**
 * A small website with known problems, for the crawler tests. `state.fixed` repairs two of
 * them so a second crawl can show that only those are resolved.
 */
import { createServer } from "node:http";

export async function startFixtureSite() {
  const state = { fixed: false, altFixed: false, hits: [] as string[], cookies: 0, userAgents: new Set<string>() };
  let origin = "";
  const page = (title: string | null, body: string, head = "") =>
    `<!doctype html><html lang="en"><head>${title === null ? "" : `<title>${title}</title>`}<meta name="viewport" content="width=device-width"><meta name="description" content="${title ?? "Page"} description that is specific to this page">${head}</head><body><h1>${title ?? "Untitled"}</h1><p>${"Plain words about surveying instruments and field notes. ".repeat(12)}</p>${body}</body></html>`;

  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    state.hits.push(path);
    if (req.headers.cookie) state.cookies++;
    state.userAgents.add(String(req.headers["user-agent"]));
    const send = (status: number, body: string, type = "text/html; charset=utf-8", headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...headers });
      res.end(body);
    };
    const redirect = (to: string) => send(301, "", "text/plain", { location: to });
    const blog = /^\/blog\/(\d+)$/.exec(path);
    if (path === "/robots.txt") return send(200, `User-agent: *\nDisallow: /private/\nSitemap: ${origin}/sitemap.xml\nSitemap: ${origin}/missing-sitemap.xml\n`, "text/plain");
    if (path === "/sitemap.xml") {
      const urls = ["/", "/about", "/orphan", "/noindex-page", "/gone", "/private/secret"].map((p) => `<url><loc>${origin}${p}</loc></url>`).join("");
      return send(200, `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, "application/xml");
    }
    if (path === "/") {
      const links = ["/about", "/no-title", "/dup-a", "/dup-b", "/broken-link-page", "/chain-1", "/canon-a", "/private/secret", "/images", "/offsite", "/blog/1", "/file.pdf"];
      return send(200, page("Fixture home", links.map((l) => `<a href="${l}">${l}</a>`).join(" ") + `<a href="http://10.0.0.1/admin">internal network</a><a href="mailto:a@b.test">mail</a><a href="#top">top</a>`, `<link rel="canonical" href="${origin}/">`));
    }
    if (path === "/about") return send(200, page("About the fixture", `<a href="/server-error">error</a> <a href="/loop">loop</a> <a href="/">home</a>`, `<link rel="canonical" href="${origin}/about">`));
    if (path === "/no-title") return send(200, page(state.fixed ? "Now it has a title" : null, `<a href="/">home</a>`));
    if (path === "/dup-a" || path === "/dup-b") return send(200, page("Same title twice", `<a href="/">home</a>`));
    if (path === "/broken-link-page") return send(200, page("Page with a link", state.fixed ? `<a href="/">home</a>` : `<a href="/missing">missing</a>`));
    if (path === "/chain-1") return redirect("/chain-2");
    if (path === "/chain-2") return redirect("/about");
    if (path === "/loop") return redirect("/loop");
    if (path === "/offsite") return redirect("http://169.254.169.254/latest/meta-data/");
    if (path === "/canon-a") return send(200, page("Canonical to nowhere", "", `<link rel="canonical" href="${origin}/canon-missing">`));
    if (path === "/noindex-page") return send(200, page("Hidden page", "", `<meta name="robots" content="noindex, follow">`));
    if (path === "/orphan") return send(200, page("Orphan page", ""));
    if (path === "/images") return send(200, page("Images", `<img src="/a.png"${state.altFixed ? ' alt="A level on a tripod"' : ""}><img src="/b.png" alt=""><script type="application/ld+json">{"@type": "Thing",}</script>`));
    if (path === "/server-error") return send(500, "boom", "text/plain");
    if (path === "/private/secret") return send(200, page("Secret", ""));
    if (path === "/file.pdf") return send(200, "%PDF-1.4", "application/pdf");
    if (blog && Number(blog[1]) <= 40) return send(200, page(`Blog post ${blog[1]}`, `<a href="/blog/${Number(blog[1]) + 1}">next</a>`));
    send(404, page("Not found", ""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  origin = `http://127.0.0.1:${port}`;
  return { origin, host: `127.0.0.1:${port}`, state, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
