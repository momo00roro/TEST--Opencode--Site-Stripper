import { join, resolve, sep } from "node:path";

const INDEX_ROUTES = new Set([
  "app",
  "features",
  "how-it-works",
  "sample-pack",
  "faq",
  "sign-up",
  "sign-in",
  "sign-up/complete",
  "sign-in/complete",
  "terms",
  "privacy",
]);

export function resolveLocalStaticPath(pathname: string, webRoot: string): string | null {
  const root = resolve(webRoot);
  const route = pathname.replace(/^\/+|\/+$/g, "");
  const relative = route === ""
    ? "index.html"
    : INDEX_ROUTES.has(route)
      ? join(route, "index.html")
      : pathname.replace(/^\/+/, "");
  const target = resolve(join(root, relative));

  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}
