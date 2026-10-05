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
  rightmove: (district, context = {}) => /^fitzrovia$/i.test(district)
    ? \`https://www.rightmove.co.uk/property-to-rent/find.html?maxPrice=\${encodeURIComponent(context.monthlyMax || "")}&index=0&sortType=6&channel=RENT&transactionType=LETTING&locationIdentifier=REGION%5E93764&displayLocationIdentifier=undefined\`
    : \`https://www.rightmove.co.uk/property-to-rent/\${encodeURIComponent(district)}.html\`,
  spareroom: district => \`https://www.spareroom.co.uk/flatshare/london/\${slug(district)}\`,
  openrent: district => \`https://www.openrent.co.uk/properties-to-rent/\${slug(district)}\`,
  sturents: () => "https://sturents.com/student-accommodation/London/",
  onthemarket: district => \`https://www.onthemarket.com/student/property/\${slug(district)}/\`
};
const SOURCE_NAMES = { zoopla: "Zoopla", rightmove: "Rightmove", spareroom: "SpareRoom", openrent: "OpenRent", sturents: "StuRents", onthemarket: "OnTheMarket" };
const SOURCE_HOSTS = {
  zoopla: ["zoopla.co.uk"], rightmove: ["rightmove.co.uk"], spareroom: ["spareroom.co.uk"],
  openrent: ["openrent.co.uk"], sturents: ["sturents.com"], onthemarket: ["onthemarket.com"]
};

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
  const monthlyMax = unit === "per month" ? Math.round(max) : Math.round(max * 52 / 12);
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
    body: JSON.stringify({ url: SOURCE_URLS[source](district, { monthlyMax }), goal, browser_profile: "stealth", api_integration: "tinyroomfinder", proxy_config: { enabled: true, country_code: "GB" }, agent_config: { max_duration_seconds: 300, cursor_style: "standard" }, capture_config: { elements: false, snapshots: false, screenshots: false, recording: false, html: false }, output_schema })
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
  const monitor = result?.monitor || result || {};
  return json({ monitor: { id: monitor.id || monitor.monitor_id || null, name: monitor.name || \`TinyRoomFinder: \${district}\`, status: monitor.status || "created", schedule_cron: monitor.schedule_cron || schedules[frequency].cron }, baseline_created: Boolean(result?.run), email_requires_dashboard: true, dashboard_url: "https://agent.tinyfish.ai/monitor" }, 201);
}

function allowedListingUrl(source, value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && SOURCE_HOSTS[source]?.some(host => url.hostname === host || url.hostname.endsWith(\`.\${host}\`));
  } catch { return false; }
}

async function fetchListings(request, env) {
  if (!env.TINYFISH_API_KEY) return json({ error: { message: "TinyFish is not configured for this app." } }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: { message: "Invalid request body." } }, 400); }
  const source = String(body.source || "").toLowerCase();
  const prefs = body.preferences || {};
  const candidates = Array.isArray(body.listings) ? body.listings.slice(0, 8) : [];
  if (!SOURCE_HOSTS[source] || !candidates.length) return json({ error: { message: "No supported listing pages were supplied." } }, 400);
  const listings = candidates.filter(item => item && allowedListingUrl(source, item.url)).map(item => ({
    title: String(item.title || "Listing").slice(0, 300), displayed_price: String(item.displayed_price || "").slice(0, 100),
    weekly_price_gbp: Number(item.weekly_price_gbp), location: item.location == null ? null : String(item.location).slice(0, 200),
    accommodation_type: item.accommodation_type == null ? null : String(item.accommodation_type).slice(0, 120),
    bills_included: item.bills_included == null ? null : String(item.bills_included).slice(0, 120),
    available_from: item.available_from == null ? null : String(item.available_from).slice(0, 120), url: String(item.url)
  }));
  if (!listings.length) return json({ error: { message: "The agent did not return valid listing links for this source." } }, 400);
  const district = String(prefs.district || "London").slice(0, 80);
  const min = Number(prefs.budgetMin); const max = Number(prefs.budgetMax);
  const unit = prefs.budgetUnit === "per month" ? "per month" : "per week";
  const upstream = await fetch("https://api.fetch.tinyfish.ai", {
    method: "POST",
    headers: { "X-API-Key": env.TINYFISH_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ urls: listings.map(item => item.url), format: "markdown", links: false, image_links: false, ttl: 0, purpose: \`Download current accommodation listing details for \${district}, including the displayed price and location, to support a student rental search with a £\${min}–£\${max} \${unit} budget.\` })
  });
  let result = null;
  try { result = await upstream.json(); } catch {}
  if (!upstream.ok) return json({ error: { message: result?.error?.message || result?.message || "TinyFish Fetch could not download the listing pages." } }, upstream.status || 502);
  const downloaded = Array.isArray(result?.results) ? result.results : [];
  const downloadedUrls = new Set();
  for (const item of downloaded) {
    if (item?.url) downloadedUrls.add(item.url);
    if (item?.final_url) downloadedUrls.add(item.final_url);
  }
  return json({ source: SOURCE_NAMES[source], listings: listings.map(item => {
    const fetched = downloaded.find(resultItem => resultItem?.url === item.url || resultItem?.final_url === item.url);
    return { ...item, fetch_downloaded: downloadedUrls.has(item.url) || Boolean(fetched), fetch_title: fetched?.title || null };
  }), fetched_count: downloaded.length, errors: Array.isArray(result?.errors) ? result.errors.length : 0 });
}

function pdfText(value) {
  return String(value ?? "").replace(/£/g, "\\\\243").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/([\\\\()])/g, "\\\\$1");
}

function buildResultsPdf(listings, prefs) {
  const objects = [null, null, null, null];
  const addObject = value => { objects.push(value); return objects.length - 1; };
  const pageIds = [];
  const chunks = [];
  for (let index = 0; index < listings.length; index += 7) chunks.push(listings.slice(index, index + 7));
  chunks.forEach((pageListings, pageIndex) => {
    const commands = [
      "BT /F1 18 Tf 50 795 Td (Student accommodation results) Tj ET",
      "BT /F1 10 Tf 50 775 Td (" + pdfText(prefs.district || "London") + " | Budget: " + pdfText("£" + prefs.budgetMin + "-£" + prefs.budgetMax + " " + prefs.budgetUnit) + " | Page " + (pageIndex + 1) + " of " + chunks.length + ") Tj ET"
    ];
    const links = [];
    pageListings.forEach((item, itemIndex) => {
      const y = 735 - itemIndex * 96;
      const safeUrl = encodeURI(String(item.url));
      commands.push("BT /F1 12 Tf 50 " + y + " Td (" + pdfText((pageIndex * 7 + itemIndex + 1) + ". " + (item.source || "Rental website")) + ") Tj ET");
      commands.push("BT /F1 10 Tf 62 " + (y - 17) + " Td (Price: " + pdfText(item.displayed_price || ("£" + Math.round(item.weekly_price_gbp) + " pw")) + ") Tj ET");
      commands.push("BT /F1 10 Tf 62 " + (y - 34) + " Td (Location: " + pdfText(item.location || "See listing") + ") Tj ET");
      commands.push("BT /F1 9 Tf 62 " + (y - 51) + " Td (Listing: " + pdfText(safeUrl.slice(0, 105)) + ") Tj ET");
      links.push({ url: safeUrl, y: y - 53 });
    });
    const stream = commands.join("\\n");
    const contentId = addObject("<< /Length " + stream.length + " >>\\nstream\\n" + stream + "\\nendstream");
    const annotationIds = links.map(link => addObject("<< /Type /Annot /Subtype /Link /Rect [60 " + link.y + " 545 " + (link.y + 13) + "] /Border [0 0 0] /A << /S /URI /URI (" + pdfText(link.url) + ") >> >>"));
    const pageId = addObject("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " + contentId + " 0 R /Annots [" + annotationIds.map(id => id + " 0 R").join(" ") + "] >>");
    pageIds.push(pageId);
  });
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Count " + pageIds.length + " /Kids [" + pageIds.map(id => id + " 0 R").join(" ") + "] >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  let pdf = "%PDF-1.4\\n% TinyRoomFinder\\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) { offsets[id] = pdf.length; pdf += id + " 0 obj\\n" + objects[id] + "\\nendobj\\n"; }
  const xref = pdf.length;
  pdf += "xref\\n0 " + objects.length + "\\n0000000000 65535 f \\n";
  for (let id = 1; id < objects.length; id += 1) pdf += String(offsets[id]).padStart(10, "0") + " 00000 n \\n";
  pdf += "trailer\\n<< /Size " + objects.length + " /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF";
  return new TextEncoder().encode(pdf);
}

async function exportPdf(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: { message: "Invalid request body." } }, 400); }
  const prefs = body.preferences || {};
  const min = Number(prefs.budgetMin); const max = Number(prefs.budgetMax);
  const weeklyMin = prefs.budgetUnit === "per month" ? min * 12 / 52 : min;
  const weeklyMax = prefs.budgetUnit === "per month" ? max * 12 / 52 : max;
  const allHosts = Object.values(SOURCE_HOSTS).flat();
  const listings = (Array.isArray(body.listings) ? body.listings : []).slice(0, 48).filter(item => {
    if (!item?.fetch_downloaded || !Number.isFinite(Number(item.weekly_price_gbp)) || Number(item.weekly_price_gbp) < weeklyMin || Number(item.weekly_price_gbp) > weeklyMax) return false;
    try { const url = new URL(item.url); return url.protocol === "https:" && allHosts.some(host => url.hostname === host || url.hostname.endsWith(\`.\${host}\`)); } catch { return false; }
  });
  if (!listings.length) return json({ error: { message: "No in-budget TinyFish Fetch results are available for the PDF yet." } }, 400);
  const pdf = buildResultsPdf(listings, prefs);
  return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=student_accommodation_results.pdf", "Cache-Control": "no-store" } });
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
    if (request.method === "POST" && url.pathname === "/api/fetch/listings") return fetchListings(request, env);
    if (request.method === "POST" && url.pathname === "/api/monitor/create") return createMonitor(request, env);
    if (request.method === "POST" && url.pathname === "/api/export/pdf") return exportPdf(request);
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
