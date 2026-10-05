# TinyRoomFinder

TinyRoomFinder is a London student-accommodation search app powered by three separate TinyFish services:

1. **TinyFish Agent** opens and interacts with rental websites using the student's preferences.
2. **TinyFish Fetch** downloads every listing page returned by a successful agent.
3. **TinyFish Monitor** optionally repeats the search on a weekly schedule after the student opts in.

The live app is available at [london-student-homefinder.douckidouk.chatgpt.site](https://london-student-homefinder.douckidouk.chatgpt.site).

## What the student experiences

1. The student enters their university, district, minimum and maximum budget, budget unit, and whether they want to live alone or share.
2. The current interface starts separate TinyFish browser-agent searches for Rightmove and SpareRoom. The backend also has validated source definitions for Zoopla, OpenRent, StuRents and OnTheMarket, which can be enabled in the frontend source list.
3. The interface streams agent progress and can show the live TinyFish browser.
4. Each agent returns structured listing candidates containing a title, visible price, normalized weekly price, location and URL.
5. The app rejects candidates without a numeric price or outside the student's price range.
6. TinyFish Fetch downloads the accepted listing URLs with `ttl: 0`, so it requests fresh page content rather than intentionally accepting an old cached copy.
7. The result card displays the website, direct listing link, price, location and Fetch status.
8. The student can download a PDF containing only in-budget listings whose pages were successfully downloaded by TinyFish Fetch.
9. Once searching finishes, the app asks whether the student wants weekly updates. If they agree, it creates a TinyFish Topic Monitor with the same district, budget and living preference.

## Request flow

```text
Student submits preferences
        |
        v
dist/app.js: runAllAgents()
        |
        |  two websites at a time
        v
POST /api/agent/search
        |
        v
TinyFish /v1/automation/run-sse
        |
        |  STARTED -> STREAMING_URL -> PROGRESS -> COMPLETE
        v
Structured listing candidates
        |
        v
POST /api/fetch/listings
        |
        v
TinyFish Fetch: https://api.fetch.tinyfish.ai
        |
        v
Visible cards + downloadable PDF
        |
        v
Optional POST /api/monitor/create
        |
        v
TinyFish Topic Monitor
```

## Exactly where TinyFish Agent is summoned

There are two parts to starting an agent: the browser calls the app's private backend route, and the backend calls TinyFish.

### 1. Browser-side trigger

The active source list is declared at [`dist/app.js` lines 20–28](dist/app.js#L20-L28). The search form submits at [`dist/app.js` lines 121–127](dist/app.js#L121-L127). `runAllAgents()` then starts the enabled sources in pairs at [`dist/app.js` lines 129–144](dist/app.js#L129-L144).

The exact browser-side request that starts one source agent is at [`dist/app.js` line 150](dist/app.js#L150):

```js
fetch("/api/agent/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ source: source.id, preferences: prefs }),
  signal
});
```

This route is called once for each enabled rental website. The browser never receives the TinyFish API key.

### 2. Server-side TinyFish Agent call

`startAgent()` is defined at [`scripts/build-worker.mjs` lines 35–71](scripts/build-worker.mjs#L35-L71).

The code first:

- validates the requested source and student preferences;
- converts monthly budgets to weekly values for consistent comparison;
- converts weekly maximums to monthly values for Rightmove's URL parameter;
- constructs a strict natural-language goal; and
- defines the required JSON output schema.

The goal at [`scripts/build-worker.mjs` line 52](scripts/build-worker.mjs#L52) tells the agent that price is a hard requirement. It must apply minimum and maximum filters, verify visible prices, normalize monthly prices with `monthly × 12 ÷ 52`, reject unpriced or out-of-range listings, and use per-person prices for shared accommodation.

The exact call that summons TinyFish is at [`scripts/build-worker.mjs` lines 64–68](scripts/build-worker.mjs#L64-L68):

```js
fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
  method: "POST",
  headers: {
    "X-API-Key": env.TINYFISH_API_KEY,
    "Content-Type": "application/json",
    "Accept": "text/event-stream"
  },
  body: JSON.stringify({
    url: SOURCE_URLS[source](district, { monthlyMax }),
    goal,
    browser_profile: "stealth",
    api_integration: "tinyroomfinder",
    proxy_config: { enabled: true, country_code: "GB" },
    agent_config: { max_duration_seconds: 300, cursor_style: "standard" },
    capture_config: {
      elements: false,
      snapshots: false,
      screenshots: false,
      recording: false,
      html: false
    },
    output_schema
  })
});
```

`run-sse` is used because this is an interactive app. It provides real-time events and a watchable browser URL rather than making the student wait on an unchanging screen.

### Agent event handling

The frontend reads TinyFish's Server-Sent Events at [`dist/app.js` lines 153–181](dist/app.js#L153-L181):

- `STARTED` stores the TinyFish run ID.
- `STREAMING_URL` displays the live browser iframe.
- `PROGRESS` updates the source status.
- `COMPLETE` reads the structured result and begins the Fetch stage.

The Stop button aborts the browser request and calls TinyFish's run-cancellation endpoint at [`dist/app.js` lines 220–224](dist/app.js#L220-L224) and [`scripts/build-worker.mjs` lines 214–221](scripts/build-worker.mjs#L214-L221).

## Rental-source URLs

The source builders are at [`scripts/build-worker.mjs` lines 16–25](scripts/build-worker.mjs#L16-L25). The backend supports Zoopla, Rightmove, SpareRoom, OpenRent, StuRents and OnTheMarket; the current frontend source list enables Rightmove and SpareRoom.

For Fitzrovia, Rightmove starts from a prefiltered URL containing `maxPrice`, sorting and the supplied `REGION^93764` location identifier. When the student enters a weekly budget, the app converts the maximum to an approximate monthly value because Rightmove's rental price parameter is monthly. Other districts use the district-specific Rightmove route.

Each source has an allowlisted hostname at [`scripts/build-worker.mjs` lines 27–30](scripts/build-worker.mjs#L27-L30). This prevents the Fetch and PDF routes from accepting arbitrary third-party URLs.

## TinyFish Fetch implementation

TinyFish Agent and TinyFish Fetch have different jobs:

- **Agent** interacts with a dynamic search website and returns structured candidates.
- **Fetch** downloads the individual candidate pages after the agent has found them.

After a `COMPLETE` event, the browser calls `/api/fetch/listings` at [`dist/app.js` lines 198–208](dist/app.js#L198-L208).

The backend validates and sanitizes a maximum of eight URLs at [`scripts/build-worker.mjs` lines 114–130](scripts/build-worker.mjs#L114-L130). It then summons TinyFish Fetch at [`scripts/build-worker.mjs` lines 133–137](scripts/build-worker.mjs#L133-L137):

```js
fetch("https://api.fetch.tinyfish.ai", {
  method: "POST",
  headers: {
    "X-API-Key": env.TINYFISH_API_KEY,
    "Content-Type": "application/json",
    "Accept": "application/json"
  },
  body: JSON.stringify({
    urls: listings.map(item => item.url),
    format: "markdown",
    links: false,
    image_links: false,
    ttl: 0,
    purpose: "Download current accommodation listing details..."
  })
});
```

Only returned URLs are marked `fetch_downloaded: true`. Result rendering and a second numeric budget check happen at [`dist/app.js` lines 210–214](dist/app.js#L210-L214).

If one website fails, the app marks that source as needing attention and continues with the other sources. This matters because rental websites can independently show login screens, bot checks or temporary errors.

## PDF implementation

The **Download results PDF** control is declared at [`dist/index.html` lines 141–145](dist/index.html#L141-L145) and handled at [`dist/app.js` lines 252–264](dist/app.js#L252-L264).

The backend PDF route is implemented at [`scripts/build-worker.mjs` lines 153–212](scripts/build-worker.mjs#L153-L212). Before writing the PDF it checks that every item:

- was successfully downloaded by TinyFish Fetch;
- has a numeric weekly price inside the student's range; and
- belongs to one of the six allowlisted rental domains.

Each PDF entry includes the source website, displayed price, location, visible URL and a clickable PDF link annotation. The file is downloaded as `student_accommodation_results.pdf`.

## TinyFish Monitor implementation

The monitoring question appears only after the current search finishes. The UI is declared at [`dist/index.html` lines 129–140](dist/index.html#L129-L140), and the button handler calls `/api/monitor/create` at [`dist/app.js` lines 226–246](dist/app.js#L226-L246).

The backend builds the schedule, topic query and exact budget-aware purpose at [`scripts/build-worker.mjs` lines 73–94](scripts/build-worker.mjs#L73-L94). The exact TinyFish Monitor request is at [`scripts/build-worker.mjs` lines 95–99](scripts/build-worker.mjs#L95-L99):

```js
fetch("https://agent.tinyfish.ai/v1/monitors", {
  method: "POST",
  headers: {
    "X-API-Key": env.TINYFISH_API_KEY,
    "Content-Type": "application/json",
    "Accept": "application/json"
  },
  body: JSON.stringify({
    type: "search",
    name,
    config: { query, recency_minutes, result_limit: 10 },
    schedule_cron,
    purpose
  })
});
```

The default is weekly at 09:00 London time. Daily and twice-weekly options are also available. Creating a monitor performs TinyFish's immediate baseline run and activates its future schedule.

TinyFish currently manages email delivery in its dashboard; the Monitor REST API does not accept an email address. The app therefore records the student's email in the downloadable preferences file and links them to the TinyFish dashboard to confirm email delivery.

## Backend routes

The Worker route table is at [`scripts/build-worker.mjs` lines 224–237](scripts/build-worker.mjs#L224-L237).

| Route | Purpose |
| --- | --- |
| `POST /api/agent/search` | Start one TinyFish browser agent and proxy its SSE stream. |
| `POST /api/agent/cancel` | Cancel an active TinyFish run. |
| `POST /api/fetch/listings` | Download accepted listing pages through TinyFish Fetch. |
| `POST /api/export/pdf` | Create a filtered PDF from Fetch-confirmed listings. |
| `POST /api/monitor/create` | Create a TinyFish Topic Monitor and baseline run. |
| `GET /student_accommodation_preferences.md` | Serve the preferences file stored inside the app. |

## Security and data handling

- `TINYFISH_API_KEY` exists only in the Worker environment and is never sent to the browser.
- All API inputs are validated server-side.
- Fetch and PDF URLs must use HTTPS and match an allowlisted rental domain.
- Search results are escaped before being inserted into the page.
- Agent searches can be stopped and their TinyFish run IDs are cancelled.
- The app does not collect rental-site passwords.
- Preferences and result PDFs are generated on demand; the app does not persist search results in a database.

## Project files

- `dist/index.html` — accessible application structure and controls.
- `dist/styles.css` — responsive visual design.
- `dist/app.js` — browser-side preferences, Agent streaming, Fetch orchestration, rendering, PDF download and Monitor opt-in.
- `scripts/build-worker.mjs` — source for the Cloudflare Worker and every server-side TinyFish call.
- `dist/server/index.js` — generated Worker entrypoint. Do not edit it directly; regenerate it.
- `student_accommodation_preferences.md` — the preference file stored inside the app.
- `.openai/hosting.json` — Sites deployment configuration.

## Run locally

The app requires a Worker-compatible runtime because the backend streams TinyFish events and keeps the API key server-side.

1. Set `TINYFISH_API_KEY` in the runtime environment. Never commit it.
2. Regenerate the Worker:

   ```bash
   node scripts/build-worker.mjs
   ```

3. Serve `dist/server/index.js` with a Cloudflare Worker-compatible local runtime.

After editing `dist/index.html`, `dist/styles.css`, `dist/app.js` or `student_accommodation_preferences.md`, always rerun the build script because those files are embedded into the generated Worker.

## Verification performed

The implementation was checked with:

- JavaScript syntax validation for both browser and Worker files;
- mocked route tests for TinyFish Agent payload construction, domain validation and Fetch response mapping;
- a real TinyFish Agent run against SpareRoom that returned in-budget listings with prices, locations and URLs;
- a real TinyFish Fetch request against one of those returned listing URLs;
- an integrated Fetch-to-PDF test that created a valid PDF with a clickable URI annotation; and
- a visual and console-error check of the deployed app.

## Safety reminder

Students should independently verify the landlord, tenancy agreement, deposit protection, bills, property condition and total move-in cost before paying anything.
