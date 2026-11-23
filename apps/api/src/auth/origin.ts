// Browser origins allowed to call the API with the session cookie (CORS and the CSRF Origin
// check in server.ts). Localhost ports only when the web app itself runs on localhost (local
// dev); production accepts its own web app's origin and nothing else.
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function isAllowedOrigin(origin: string, webAppUrl: string): boolean {
  if (origin === webAppUrl) return true;
  return LOCAL.test(webAppUrl) && LOCAL.test(origin);
}
