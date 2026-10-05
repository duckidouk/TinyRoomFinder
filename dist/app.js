const universityMap = [
  { test: /ucl|university college london/i, district: "Fitzrovia", reason: "Close to UCL’s main Bloomsbury campus, with easy walking access." },
  { test: /king'?s college|kcl/i, district: "Waterloo", reason: "Well placed for the Strand and Waterloo campuses, with strong transport links." },
  { test: /imperial/i, district: "South Kensington", reason: "The most convenient base for Imperial’s main campus and nearby museums." },
  { test: /lse|london school of economics/i, district: "Holborn", reason: "A short walk from the LSE campus around Aldwych and Lincoln’s Inn Fields." },
  { test: /queen mary|qmul/i, district: "Mile End", reason: "Right by Queen Mary’s main campus and connected by the Central line." },
  { test: /soas/i, district: "Bloomsbury", reason: "SOAS is based in Bloomsbury, close to Russell Square." },
  { test: /westminster/i, district: "Fitzrovia", reason: "Convenient for the Regent Street and Marylebone university buildings." },
  { test: /city st george|city, university|st george/i, district: "Clerkenwell", reason: "A practical base for City’s Northampton Square campus." },
  { test: /goldsmith/i, district: "New Cross", reason: "Goldsmiths’ campus sits in New Cross, near the Overground and National Rail." },
  { test: /greenwich/i, district: "Greenwich", reason: "Close to the riverside Greenwich campus and DLR connections." },
  { test: /brunel/i, district: "Uxbridge", reason: "The closest district to Brunel’s west London campus." },
  { test: /roehampton/i, district: "Roehampton", reason: "The natural local base for the University of Roehampton campus." },
  { test: /london metropolitan|london met/i, district: "Holloway", reason: "Close to the Holloway Road campus and Piccadilly line." },
  { test: /royal college of art|rca/i, district: "South Kensington", reason: "Convenient for the RCA’s Kensington campus." },
  { test: /central saint martins/i, district: "King's Cross", reason: "The campus is at Granary Square, beside King’s Cross and St Pancras." },
  { test: /ual|university of the arts/i, district: "King's Cross", reason: "A useful starting point for UAL; confirm your specific college before searching." }
];

const sources = [
  { id: "zoopla", name: "Zoopla", initials: "Z", note: "Student accommodation and whole properties" },
  { id: "rightmove", name: "Rightmove", initials: "R", note: "Flats, houses and student accommodation" },
  { id: "spareroom", name: "SpareRoom", initials: "S", note: "Rooms and shared homes" },
  { id: "openrent", name: "OpenRent", initials: "O", note: "Direct landlord listings" },
  { id: "sturents", name: "StuRents", initials: "SR", note: "Student houses, flats and private halls" },
  { id: "onthemarket", name: "OnTheMarket", initials: "OT", note: "Student properties from agents" }
];

const form = document.querySelector("#preferences-form");
const university = document.querySelector("#university");
const recommendation = document.querySelector("#recommendation");
const recommendedDistrict = document.querySelector("#recommended-district");
const recommendationReason = document.querySelector("#recommendation-reason");
const otherWrap = document.querySelector("#other-district-wrap");
const otherDistrict = document.querySelector("#other-district");
const formError = document.querySelector("#form-error");
const searchButton = document.querySelector("#search-button");
const agentToolbar = document.querySelector("#agent-toolbar");
const agentSummary = document.querySelector("#agent-summary");
const liveBrowser = document.querySelector("#live-browser");
const liveBrowserFrame = document.querySelector("#live-browser-frame");
const liveBrowserLink = document.querySelector("#live-browser-link");
const liveBrowserSource = document.querySelector("#live-browser-source");
const stopAgents = document.querySelector("#stop-agents");
let currentPreferences = null;
let currentSearchController = null;
let activeRunIds = new Set();

function getRecommendation(value) {
  return universityMap.find(item => item.test.test(value)) || { district: "Central London", reason: "We could not match the campus automatically. Choose another district if you know where you want to live." };
}

function updateRecommendation() {
  const value = university.value.trim();
  if (value.length < 3) { recommendation.hidden = true; return; }
  const match = getRecommendation(value);
  recommendedDistrict.textContent = match.district;
  recommendationReason.textContent = match.reason;
  recommendation.hidden = false;
}

university.addEventListener("input", updateRecommendation);
document.querySelectorAll('input[name="district-choice"]').forEach(input => input.addEventListener("change", event => {
  const choosingOther = event.target.value === "other";
  otherWrap.hidden = !choosingOther;
  otherDistrict.required = choosingOther;
  if (choosingOther) otherDistrict.focus();
}));

function getPreferences() {
  const data = new FormData(form);
  const choice = data.get("district-choice") || "recommended";
  const recommended = getRecommendation(data.get("university") || "").district;
  return {
    university: String(data.get("university") || "").trim(),
    recommendedDistrict: recommended,
    district: choice === "other" ? String(data.get("other-district") || "").trim() : recommended,
    budgetMin: Number(data.get("budget-min")), budgetMax: Number(data.get("budget-max")),
    budgetUnit: String(data.get("budget-unit")), living: String(data.get("living") || ""),
    email: String(data.get("email") || "").trim(), frequency: String(data.get("frequency"))
  };
}

function validatePreferences(prefs) {
  if (!prefs.university || !prefs.district || !prefs.living) return "Please complete the university, district and living-arrangement questions.";
  if (!Number.isFinite(prefs.budgetMin) || !Number.isFinite(prefs.budgetMax) || prefs.budgetMin < 0 || prefs.budgetMax <= 0) return "Please enter a valid minimum and maximum budget.";
  if (prefs.budgetMin > prefs.budgetMax) return "Your minimum budget cannot be higher than your maximum.";
  if (prefs.frequency !== "Do not monitor" && !prefs.email) return "Add an email address, or choose ‘Do not monitor’.";
  return "";
}

function prepareResults(prefs) {
  document.querySelector("#empty-state").hidden = true;
  document.querySelector("#results").hidden = false;
  document.querySelector("#results-title").textContent = `Homes in ${prefs.district}`;
  document.querySelector("#filter-summary").innerHTML = [prefs.university, `£${prefs.budgetMin.toLocaleString()}–£${prefs.budgetMax.toLocaleString()} ${prefs.budgetUnit}`, prefs.living].map(item => `<span>${escapeHtml(item)}</span>`).join("");
  document.querySelector("#source-results").innerHTML = sources.map(source => `
    <section class="source-agent" id="source-${source.id}">
      <div class="source-agent-head"><span class="source-icon">${source.initials}</span><span><strong>${source.name}</strong><small>${source.note}</small></span><span class="source-status" data-state="waiting">Waiting</span></div>
      <p class="source-note">The browser agent will apply your district, budget and household preferences.</p><div class="listing-list" hidden></div>
    </section>`).join("");
  document.querySelector("#monitor-status").textContent = prefs.frequency === "Do not monitor" ? "Monitoring is off. This search runs only while the app is open." : `Monitor preference saved: check ${prefs.frequency.toLowerCase()} and email ${prefs.email}.`;
  document.querySelector("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", async event => {
  event.preventDefault(); updateRecommendation();
  const prefs = getPreferences(); const error = validatePreferences(prefs);
  formError.hidden = !error; formError.textContent = error;
  if (error) return;
  currentPreferences = prefs; prepareResults(prefs); await runAllAgents(prefs);
});

async function runAllAgents(prefs) {
  if (currentSearchController) currentSearchController.abort();
  currentSearchController = new AbortController(); activeRunIds = new Set();
  agentToolbar.hidden = false; stopAgents.hidden = false; liveBrowser.hidden = true; searchButton.disabled = true; searchButton.textContent = "Agents searching…";
  let completed = 0; let found = 0; agentSummary.textContent = `0 of ${sources.length} sources complete`;
  for (let index = 0; index < sources.length; index += 2) {
    if (currentSearchController.signal.aborted) break;
    const results = await Promise.all(sources.slice(index, index + 2).map(source => runSourceAgent(source, prefs, currentSearchController.signal)));
    completed += results.length; found += results.reduce((total, result) => total + result, 0);
    agentSummary.textContent = `${completed} of ${sources.length} sources complete · ${found} listings found`;
  }
  searchButton.disabled = false; searchButton.textContent = "Run TinyFish agents again";
  agentSummary.textContent = currentSearchController.signal.aborted ? `Search stopped · ${found} listings kept` : `Search complete · ${found} listings found`;
  stopAgents.hidden = true;
}

async function runSourceAgent(source, prefs, signal) {
  const root = document.querySelector(`#source-${source.id}`); const status = root.querySelector(".source-status"); const note = root.querySelector(".source-note"); const list = root.querySelector(".listing-list");
  status.dataset.state = "running"; status.textContent = "Starting agent";
  try {
    const response = await fetch("/api/agent/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: source.id, preferences: prefs }), signal });
    if (!response.ok) throw new Error(await readError(response));
    if (!response.body) throw new Error("The browser-agent stream was unavailable.");
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let listingCount = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || "";
      for (const block of blocks) {
        const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        if (!data) continue;
        let event; try { event = JSON.parse(data); } catch { continue; }
        if (event.type === "STARTED") { activeRunIds.add(event.run_id); status.textContent = "Browser running"; }
        else if (event.type === "STREAMING_URL") showLiveBrowser(source.name, event.streaming_url);
        else if (event.type === "PROGRESS") { status.textContent = "Searching"; note.textContent = event.purpose || "The agent is checking listings and prices."; }
        else if (event.type === "COMPLETE") {
          if (event.run_id) activeRunIds.delete(event.run_id);
          if (event.status !== "COMPLETED") throw new Error(event.error?.message || "The agent could not finish this site.");
          const result = normalizeResult(event.result ?? event.resultJson ?? event.result_json);
          listingCount = renderListings(list, result.listings || []);
          note.textContent = result.search_notes || (listingCount ? "Prices and details were read by the TinyFish browser agent." : "No matching listings were returned.");
          status.dataset.state = "complete"; status.textContent = `${listingCount} found`;
        }
      }
    }
    return listingCount;
  } catch (error) {
    if (signal.aborted) { status.textContent = "Stopped"; note.textContent = "This search was stopped."; }
    else { status.dataset.state = "error"; status.textContent = "Needs attention"; note.textContent = error.message || "The agent could not search this source."; }
    return 0;
  }
}

function normalizeResult(value) { if (!value) return { listings: [] }; if (typeof value === "string") { try { return JSON.parse(value); } catch { return { listings: [], search_notes: value }; } } return value; }

function renderListings(container, listings) {
  const valid = listings.filter(item => item && item.url && item.title); container.hidden = !valid.length;
  container.innerHTML = valid.map(item => { const price = item.displayed_price || (item.weekly_price_gbp ? `£${Math.round(item.weekly_price_gbp)} pw` : "Price unavailable"); const meta = [item.location, item.accommodation_type, item.bills_included, item.available_from].filter(Boolean).join(" · "); return `<a class="listing-card" href="${safeUrl(item.url)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(item.title)}</strong><span class="listing-price">${escapeHtml(price)}</span><span class="listing-meta">${escapeHtml(meta || "Open listing for details")}</span></a>`; }).join("");
  return valid.length;
}

function showLiveBrowser(sourceName, url) { if (!url || !/^https:\/\//i.test(url)) return; liveBrowser.hidden = false; liveBrowserSource.textContent = sourceName; liveBrowserFrame.src = url; liveBrowserLink.href = url; }
async function readError(response) { try { const data = await response.json(); return data.error?.message || data.message || `Agent request failed (${response.status}).`; } catch { return `Agent request failed (${response.status}).`; } }

stopAgents.addEventListener("click", async () => {
  if (currentSearchController) currentSearchController.abort();
  const runIds = [...activeRunIds]; activeRunIds.clear();
  await Promise.allSettled(runIds.map(runId => fetch("/api/agent/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) })));
});

function preferencesMarkdown(prefs) {
  const created = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(new Date());
  return `# Student accommodation preferences\n\nSaved: ${created} (London time)\n\n## Location\n\n- University: ${prefs.university}\n- Recommended district: ${prefs.recommendedDistrict}\n- Chosen district: ${prefs.district}\n\n## Budget and household\n\n- Budget: £${prefs.budgetMin.toLocaleString()}–£${prefs.budgetMax.toLocaleString()} ${prefs.budgetUnit}\n- Living arrangement: ${prefs.living}\n\n## Monitoring\n\n- Email: ${prefs.email || "Not provided"}\n- Frequency: ${prefs.frequency}\n\n## Search sources\n\n- Zoopla\n- Rightmove\n- SpareRoom\n- OpenRent\n- StuRents\n- OnTheMarket\n\n## Safety reminder\n\nVerify the landlord, tenancy terms, deposit protection, bills and total move-in cost before making a payment.\n`;
}

document.querySelector("#download-preferences").addEventListener("click", () => { if (!currentPreferences) return; const blob = new Blob([preferencesMarkdown(currentPreferences)], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "student_accommodation_preferences.md"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); });

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function safeUrl(value) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? escapeHtml(url.href) : "#"; } catch { return "#"; } }

function registerWebMcpTools() {
  const context = document.modelContext; if (!context?.registerTool) return;
  const schema = { type: "object", properties: { university: { type: "string" }, recommendedDistrict: { type: "string" }, district: { type: "string" }, budgetMin: { type: "number" }, budgetMax: { type: "number" }, budgetUnit: { enum: ["per week", "per month"] }, living: { enum: ["Live alone", "Share with others", "Either"] }, email: { type: "string" }, frequency: { enum: ["Daily", "Twice a week", "Weekly", "Do not monitor"] } }, required: ["university", "district", "budgetMin", "budgetMax", "budgetUnit", "living", "frequency"], additionalProperties: false };
  context.registerTool({ name: "set_student_accommodation_preferences", title: "Set accommodation preferences", description: "Fill the visible accommodation form and start TinyFish browser-agent searches.", inputSchema: schema, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { university.value = input.university; updateRecommendation(); const isRecommended = input.district === input.recommendedDistrict; document.querySelector(`input[name="district-choice"][value="${isRecommended ? "recommended" : "other"}"]`).click(); otherDistrict.value = isRecommended ? "" : input.district; document.querySelector("#budget-min").value = input.budgetMin; document.querySelector("#budget-max").value = input.budgetMax; document.querySelector("#budget-unit").value = input.budgetUnit; document.querySelector(`input[name="living"][value="${input.living}"]`).click(); document.querySelector("#email").value = input.email || ""; document.querySelector("#frequency").value = input.frequency; form.requestSubmit(); return { status: "agents_started", district: input.district, sources: sources.map(source => source.name) }; } });
  context.registerTool({ name: "read_student_accommodation_preferences", title: "Read accommodation preferences", description: "Read the current accommodation preferences and monitoring frequency.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute() { return currentPreferences || { status: "not_completed" }; } });
}

registerWebMcpTools();
