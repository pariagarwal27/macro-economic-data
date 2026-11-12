"use client";

/** These views fetch their data in the browser and need no server navigation. */
export function isDashboardPath(pathname: string): boolean {
  return ["/", "/calendar", "/latest-updated"].includes(pathname)
    || /^\/country\/(us|uk|ea)\/?$/i.test(pathname);
}

export function installDashboardNavigation(): () => void {
  const navigate = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href);
    if (url.origin !== window.location.origin || !isDashboardPath(window.location.pathname) || !isDashboardPath(url.pathname)) return;
    // Leave in-page section links to the browser.
    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
    event.preventDefault();
    const href = url.pathname + url.search + url.hash;
    if (href !== window.location.pathname + window.location.search + window.location.hash) window.history.pushState(null, "", href);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  document.addEventListener("click", navigate, true);
  return () => document.removeEventListener("click", navigate, true);
}
