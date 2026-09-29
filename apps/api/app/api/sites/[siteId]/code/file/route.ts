import { fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

const LANG: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", md: "markdown", json: "json", sql: "sql", css: "css" };

export const GET = siteRoute(async ({ request, site }) => {
  const path = new URL(request.url).searchParams.get("path");
  if (!path || path.includes("..")) return fail("Pass a repository path.", 400);
  return json({ path, language: LANG[path.split(".").pop() ?? ""] ?? "plaintext", content: await store.codeFile(site.id, path) });
});
