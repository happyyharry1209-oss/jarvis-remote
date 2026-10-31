export const STORAGE = {
  backend: "jarvis_backend",
  token: "jarvis_token",
  key: "jarvis_key",
  device: "jarvis_device_token",
};

export function normalizeBackend(value) {
  const url = new URL(String(value || "").trim());
  const loopback = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new Error("Remote backend must use HTTPS");
  }
  return url.origin;
}

export function backendWsUrl(backend, path, token) {
  const url = new URL(backend);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  url.search = `?token=${encodeURIComponent(token)}`;
  return url.toString();
}
