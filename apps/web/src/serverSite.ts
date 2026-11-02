const storageKey = "turkish-flashcards.server-site";

export function serverSiteUrl(address: string, route = "/") {
  const url = new URL(address.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password)
    throw new Error("Укажите HTTPS-адрес сервера или http://localhost с портом.");
  if (url.hostname.endsWith(".github.io")) throw new Error("GitHub Pages не содержит сервер. Нужен адрес запущенного сервера на ПК.");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Укажите адрес сервера без пути, параметров и #.");
  return new URL(/^\/study\/?(?:\?[^#\\]*)?$/.test(route) ? route : "/", url).href;
}

export function readServerSite() {
  try { return localStorage.getItem(storageKey) ?? ""; } catch { return ""; }
}

export function saveServerSite(address: string) {
  try { localStorage.setItem(storageKey, new URL(address).origin); } catch { /* Navigation works without storage. */ }
}
