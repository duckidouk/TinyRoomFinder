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
  { name: "Zoopla", initials: "Z", note: "Student accommodation and whole properties", url: d => `https://www.zoopla.co.uk/to-rent/student-accommodation/${slug(d)}/` },
  { name: "Rightmove", initials: "R", note: "Flats, houses and student accommodation", url: d => `https://www.rightmove.co.uk/property-to-rent/${encodeURIComponent(d)}.html` },
  { name: "SpareRoom", initials: "S", note: "Rooms and shared homes", url: d => `https://www.spareroom.co.uk/flatshare/london/${slug(d)}` },
  { name: "OpenRent", initials: "O", note: "Direct landlord listings", url: d => `https://www.openrent.co.uk/properties-to-rent/${slug(d)}` },
  { name: "StuRents", initials: "SR", note: "Student houses, flats and private halls", url: () => "https://sturents.com/student-accommodation/London/" },
  { name: "OnTheMarket", initials: "OT", note: "Student properties from agents", url: d => `https://www.onthemarket.com/student/property/${slug(d)}/` }
];

const form = document.querySelector("#preferences-form");
const university = document.querySelector("#university");
const recommendation = document.querySelector("#recommendation");
const recommendedDistrict = document.querySelector("#recommended-district");
const recommendationReason = document.querySelector("#recommendation-reason");
const otherWrap = document.querySelector("#other-district-wrap");
const otherDistrict = document.querySelector("#other-district");
const formError = document.querySelector("#form-error");
let currentPreferences = null;

function slug(value) {
  return value.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getRecommendation(value) {
  return universityMap.find(item => item.test.test(value)) || {
    district: "Central London",
    reason: "We could not match the campus automatically. Choose another district if you know where you want to live."
  };
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
    budgetMin: Number(data.get("budget-min")),
    budgetMax: Number(data.get("budget-max")),
    budgetUnit: String(data.get("budget-unit")),
    living: String(data.get("living") || ""),
    email: String(data.get("email") || "").trim(),
    frequency: String(data.get("frequency"))
  };
}

function validatePreferences(prefs) {
  if (!prefs.university || !prefs.district || !prefs.living) return "Please complete the university, district and living-arrangement questions.";
  if (!Number.isFinite(prefs.budgetMin) || !Number.isFinite(prefs.budgetMax) || prefs.budgetMin < 0 || prefs.budgetMax <= 0) return "Please enter a valid minimum and maximum budget.";
  if (prefs.budgetMin > prefs.budgetMax) return "Your minimum budget cannot be higher than your maximum.";
  if (prefs.frequency !== "Do not monitor" && !prefs.email) return "Add an email address, or choose ‘Do not monitor’.";
  return "";
}

function renderResults(prefs) {
  document.querySelector("#empty-state").hidden = true;
  document.querySelector("#results").hidden = false;
  document.querySelector("#results-title").textContent = `Homes in ${prefs.district}`;
  document.querySelector("#filter-summary").innerHTML = [
    prefs.university,
    `£${prefs.budgetMin.toLocaleString()}–£${prefs.budgetMax.toLocaleString()} ${prefs.budgetUnit}`,
    prefs.living
  ].map(item => `<span>${escapeHtml(item)}</span>`).join("");
  document.querySelector("#source-results").innerHTML = sources.map(source => `
    <a class="source-card" href="${source.url(prefs.district)}" target="_blank" rel="noreferrer">
      <span class="source-icon">${source.initials}</span>
      <span><strong>${source.name}</strong><small>${source.note}</small></span>
      <span class="source-action">Search now</span>
    </a>`).join("");
  const monitor = document.querySelector("#monitor-status");
  monitor.textContent = prefs.frequency === "Do not monitor"
    ? "Monitoring is off. You can still use every live search above."
    : `Monitor preference saved: check ${prefs.frequency.toLowerCase()} and email ${prefs.email}. Email delivery is ready to activate through your connected mail service.`;
  document.querySelector("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", event => {
  event.preventDefault();
  updateRecommendation();
  const prefs = getPreferences();
  const error = validatePreferences(prefs);
  formError.hidden = !error;
  formError.textContent = error;
  if (error) return;
  currentPreferences = prefs;
  renderResults(prefs);
});

function preferencesMarkdown(prefs) {
  const created = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(new Date());
  return `# Student accommodation preferences\n\nSaved: ${created} (London time)\n\n## Location\n\n- University: ${prefs.university}\n- Recommended district: ${prefs.recommendedDistrict}\n- Chosen district: ${prefs.district}\n\n## Budget and household\n\n- Budget: £${prefs.budgetMin.toLocaleString()}–£${prefs.budgetMax.toLocaleString()} ${prefs.budgetUnit}\n- Living arrangement: ${prefs.living}\n\n## Monitoring\n\n- Email: ${prefs.email || "Not provided"}\n- Frequency: ${prefs.frequency}\n\n## Search sources\n\n- Zoopla\n- Rightmove\n- SpareRoom\n- OpenRent\n- StuRents\n- OnTheMarket\n\n## Safety reminder\n\nVerify the landlord, tenancy terms, deposit protection, bills and total move-in cost before making a payment.\n`;
}

document.querySelector("#download-preferences").addEventListener("click", () => {
  if (!currentPreferences) return;
  const blob = new Blob([preferencesMarkdown(currentPreferences)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "student_accommodation_preferences.md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const schema = {
    type: "object",
    properties: {
      university: { type: "string" }, recommendedDistrict: { type: "string" }, district: { type: "string" },
      budgetMin: { type: "number" }, budgetMax: { type: "number" }, budgetUnit: { enum: ["per week", "per month"] },
      living: { enum: ["Live alone", "Share with others", "Either"] }, email: { type: "string" },
      frequency: { enum: ["Daily", "Twice a week", "Weekly", "Do not monitor"] }
    },
    required: ["university", "district", "budgetMin", "budgetMax", "budgetUnit", "living", "frequency"], additionalProperties: false
  };
  context.registerTool({
    name: "set_student_accommodation_preferences", title: "Set accommodation preferences",
    description: "Fill the visible accommodation search form and prepare live rental-site searches.", inputSchema: schema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      university.value = input.university; updateRecommendation();
      const isRecommended = input.district === input.recommendedDistrict;
      document.querySelector(`input[name="district-choice"][value="${isRecommended ? "recommended" : "other"}"]`).click();
      otherDistrict.value = isRecommended ? "" : input.district;
      document.querySelector("#budget-min").value = input.budgetMin; document.querySelector("#budget-max").value = input.budgetMax;
      document.querySelector("#budget-unit").value = input.budgetUnit;
      document.querySelector(`input[name="living"][value="${input.living}"]`).click();
      document.querySelector("#email").value = input.email || ""; document.querySelector("#frequency").value = input.frequency;
      form.requestSubmit();
      return { status: "ready", district: input.district, sources: sources.map(source => source.name) };
    }
  });
  context.registerTool({
    name: "read_student_accommodation_preferences", title: "Read accommodation preferences",
    description: "Read the currently prepared accommodation preferences and monitoring frequency.", inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() { return currentPreferences || { status: "not_completed" }; }
  });
}

registerWebMcpTools();
