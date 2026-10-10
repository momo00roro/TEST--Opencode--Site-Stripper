import { join, resolve, sep } from "node:path";

const LOCAL_LAUNCH_MARKER = "<!-- LOCAL_LAUNCH_BUTTON -->";
const LOCAL_LAUNCH_LINK = '<a class="local-launch" href="/app/">Launch app</a>';
const INDEX_ROUTES = new Set(["app", "alpha"]);

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

export function injectLocalLaunchButton(html: string): string {
  return html.replace(LOCAL_LAUNCH_MARKER, LOCAL_LAUNCH_LINK);
}
