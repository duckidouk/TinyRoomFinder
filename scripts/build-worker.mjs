import { readFile, mkdir, writeFile } from "node:fs/promises";

const [html, css, js] = await Promise.all([
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../dist/app.js", import.meta.url), "utf8")
]);

const source = `
const INDEX_HTML = ${JSON.stringify(html)};
const STYLES = ${JSON.stringify(css)};
const APP_JS = ${JSON.stringify(js)};

const SOURCE_URLS = {
  zoopla: district => \`https://www.zoopla.co.uk/to-rent/student-accommodation/\${slug(district)}/\`,
  rightmove: district => \`https://www.rightmove.co.uk/property-to-rent/\${encodeURIComponent(district)}.html\`,
  spareroom: district => \`https://www.spareroom.co.uk/flatshare/london/\${slug(district)}\`,
  openrent: district => \`https://www.openrent.co.uk/properties-to-rent/\${slug(district)}\`,
  sturents: () => "https://sturents.com/student-accommodation/London/",
  onthemarket: district => \`https://www.onthemarket.com/student/property/\${slug(district)}/\`
};
const SOURCE_NAMES = { zoopla: "Zoopla", rightmove: "Rightmove", spareroom: "SpareRoom", openrent: "OpenRent", sturents: "StuRents", onthemarket: "OnTheMarket" };

function slug(value) { return value.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }

async function startAgent(request, env) {
  if (!env.TINYFISH_API_KEY) return json({ error: { message: "TinyFish is not configured for this app." } }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: { message: "Invalid request body." } }, 400); }
  const source = String(body.source || "").toLowerCase();
  const prefs = body.preferences || {};
  if (!SOURCE_URLS[source]) return json({ error: { message: "Unsupported rental source." } }, 400);
  const district = String(prefs.district || "").trim().slice(0, 80);
  const university = String(prefs.university || "").trim().slice(0, 120);
  const living = String(prefs.living || "").trim().slice(0, 40);
  const unit = prefs.budgetUnit === "per month" ? "per month" : "per week";
  const min = Number(prefs.budgetMin); const max = Number(prefs.budgetMax);
  if (!district || !university || !living || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= 0 || min > max) return json({ error: { message: "Complete the accommodation preferences before searching." } }, 400);
  const weeklyMin = unit === "per month" ? Math.round(min * 12 / 52) : Math.round(min);
  const weeklyMax = unit === "per month" ? Math.round(max * 12 / 52) : Math.round(max);
  const siteName = SOURCE_NAMES[source];
  const goal = \`Search \${siteName} for current accommodation in \${district}, London, suitable for a student at \${university}. The user wants: \${living}. Their stated budget is £\${min} to £\${max} \${unit}, approximately £\${weeklyMin} to £\${weeklyMax} per week. Use the site's search and filters. Inspect actual result cards or listing pages so every returned price comes from the website. Exclude clearly out-of-budget listings. Return up to 8 current matches. Never invent unavailable details.\`;
  const output_schema = {
    type: "object",
    properties: {
      site: { type: "string" }, search_notes: { type: "string", nullable: true }, login_required: { type: "boolean" },
      listings: { type: "array", maxItems: 8, items: { type: "object", properties: {
        title: { type: "string" }, displayed_price: { type: "string" }, weekly_price_gbp: { type: "number", nullable: true },
        location: { type: "string", nullable: true }, accommodation_type: { type: "string", nullable: true },
        bills_included: { type: "string", nullable: true }, available_from: { type: "string", nullable: true }, url: { type: "string" }
      }, required: ["title", "displayed_price", "url"] } }
    }, required: ["site", "login_required", "listings"]
  };
  const upstream = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
    method: "POST",
    headers: { "X-API-Key": env.TINYFISH_API_KEY, "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify({ url: SOURCE_URLS[source](district), goal, browser_profile: "stealth", api_integration: "tinyroomfinder", proxy_config: { enabled: true, country_code: "GB" }, agent_config: { max_duration_seconds: 300, cursor_style: "standard" }, capture_config: { elements: false, snapshots: false, screenshots: false, recording: false, html: false }, output_schema })
  });
  if (!upstream.ok || !upstream.body) return new Response(upstream.body || JSON.stringify({ error: { message: "TinyFish could not start." } }), { status: upstream.status || 502, headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" } });
  return new Response(upstream.body, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

async function cancelAgent(request, env) {
  if (!env.TINYFISH_API_KEY) return json({ error: { message: "TinyFish is not configured." } }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: { message: "Invalid request body." } }, 400); }
  const runId = String(body.runId || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(runId)) return json({ error: { message: "Invalid run ID." } }, 400);
  const upstream = await fetch(\`https://agent.tinyfish.ai/v1/runs/\${encodeURIComponent(runId)}/cancel\`, { method: "POST", headers: { "X-API-Key": env.TINYFISH_API_KEY } });
  return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/agent/search") return startAgent(request, env);
    if (request.method === "POST" && url.pathname === "/api/agent/cancel") return cancelAgent(request, env);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
    if (url.pathname === "/" || url.pathname === "/index.html") return new Response(request.method === "HEAD" ? null : INDEX_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    if (url.pathname === "/styles.css") return new Response(request.method === "HEAD" ? null : STYLES, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    if (url.pathname === "/app.js") return new Response(request.method === "HEAD" ? null : APP_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    return new Response("Not found", { status: 404 });
  }
};
`;

await mkdir(new URL("../dist/server/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/server/index.js", import.meta.url), source);
