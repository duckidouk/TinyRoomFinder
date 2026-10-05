import { readFile, mkdir, writeFile } from "node:fs/promises";

const [html, css, js, preferencesMarkdown] = await Promise.all([
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../dist/app.js", import.meta.url), "utf8"),
  readFile(new URL("../student_accommodation_preferences.md", import.meta.url), "utf8")
]);

const source = `
const INDEX_HTML = ${JSON.stringify(html)};
const STYLES = ${JSON.stringify(css)};
const APP_JS = ${JSON.stringify(js)};
const PREFERENCES_MD = ${JSON.stringify(preferencesMarkdown)};

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
  const goal = \`Search \${siteName} for current accommodation in \${district}, London, suitable for a student at \${university}. PRICE IS A HARD REQUIREMENT: the user's exact budget is £\${min} to £\${max} \${unit}, equivalent to £\${weeklyMin} to £\${weeklyMax} per week. Apply the website's minimum and maximum price filters before reviewing results. The user wants: \${living}. Inspect actual result cards or listing pages and copy each displayed price from the website. Convert monthly prices to weekly using monthly × 12 ÷ 52. Only return a listing when weekly_price_gbp is between \${weeklyMin} and \${weeklyMax}, inclusive. Reject every listing outside that range or without a verifiable price. For shared accommodation, use the per-person room price—not the total property price. Return up to 8 current matches and never invent unavailable details.\`;
  const output_schema = {
    type: "object",
    properties: {
      site: { type: "string" }, search_notes: { type: "string", nullable: true }, login_required: { type: "boolean" },
      listings: { type: "array", maxItems: 8, items: { type: "object", properties: {
        title: { type: "string" }, displayed_price: { type: "string" }, weekly_price_gbp: { type: "number" },
        location: { type: "string", nullable: true }, accommodation_type: { type: "string", nullable: true },
        bills_included: { type: "string", nullable: true }, available_from: { type: "string", nullable: true }, url: { type: "string" }
      }, required: ["title", "displayed_price", "weekly_price_gbp", "url"] } }
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

async function createMonitor(request, env) {
  if (!env.TINYFISH_API_KEY) return json({ error: { message: "TinyFish is not configured for this app." } }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: { message: "Invalid request body." } }, 400); }
  const prefs = body.preferences || {};
  const district = String(prefs.district || "").trim().slice(0, 80);
  const university = String(prefs.university || "").trim().slice(0, 120);
  const living = String(prefs.living || "").trim().slice(0, 40);
  const unit = prefs.budgetUnit === "per month" ? "per month" : "per week";
  const min = Number(prefs.budgetMin); const max = Number(prefs.budgetMax);
  const frequency = String(prefs.frequency || "Weekly");
  const schedules = {
    "Daily": { cron: "CRON_TZ=Europe/London 0 9 * * *", recency: 1440 },
    "Twice a week": { cron: "CRON_TZ=Europe/London 0 9 * * 1,4", recency: 5040 },
    "Weekly": { cron: "CRON_TZ=Europe/London 0 9 * * 1", recency: 10080 }
  };
  if (!district || !university || !living || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= 0 || min > max || !schedules[frequency]) return json({ error: { message: "Complete a valid search and choose a monitoring frequency first." } }, 400);
  const weeklyMin = unit === "per month" ? Math.round(min * 12 / 52) : Math.round(min);
  const weeklyMax = unit === "per month" ? Math.round(max * 12 / 52) : Math.round(max);
  const domains = "(site:zoopla.co.uk OR site:rightmove.co.uk OR site:spareroom.co.uk OR site:openrent.co.uk OR site:sturents.com OR site:onthemarket.com)";
  const query = \`\"\${district}\" London student accommodation room flat to rent \${domains}\`;
  const purpose = \`Find newly available student accommodation in \${district}, London for a student at \${university}. Only treat a result as relevant when it matches \${living.toLowerCase()} and its verified per-person price is within the exact user budget of £\${min}–£\${max} \${unit} (equivalent to £\${weeklyMin}–£\${weeklyMax} per week). Reject results outside the range, results without a visible price, and total-property prices that do not show an in-range per-person price.\`;
  const upstream = await fetch("https://agent.tinyfish.ai/v1/monitors", {
    method: "POST",
    headers: { "X-API-Key": env.TINYFISH_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ type: "search", name: \`TinyRoomFinder: \${district} £\${min}–£\${max} \${unit}\`, config: { query, recency_minutes: schedules[frequency].recency, result_limit: 10 }, schedule_cron: schedules[frequency].cron, purpose })
  });
  let result = null;
  try { result = await upstream.json(); } catch {}
  if (!upstream.ok) return json({ error: { message: result?.error?.message || result?.message || "TinyFish could not create the monitor." } }, upstream.status || 502);
  return json({ monitor: { id: result?.id || result?.monitor_id || null, name: result?.name || \`TinyRoomFinder: \${district}\`, status: result?.status || "created", schedule_cron: schedules[frequency].cron }, email_requires_dashboard: true, dashboard_url: "https://agent.tinyfish.ai/monitor" }, 201);
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
    if (request.method === "POST" && url.pathname === "/api/monitor/create") return createMonitor(request, env);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
    if (url.pathname === "/" || url.pathname === "/index.html") return new Response(request.method === "HEAD" ? null : INDEX_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    if (url.pathname === "/styles.css") return new Response(request.method === "HEAD" ? null : STYLES, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    if (url.pathname === "/app.js") return new Response(request.method === "HEAD" ? null : APP_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    if (url.pathname === "/student_accommodation_preferences.md" || url.pathname === "/student_accomodation_preferences.md") return new Response(request.method === "HEAD" ? null : PREFERENCES_MD, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": "inline; filename=student_accommodation_preferences.md", "Cache-Control": "no-cache" } });
    return new Response("Not found", { status: 404 });
  }
};
`;

await mkdir(new URL("../dist/server/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/server/index.js", import.meta.url), source);
