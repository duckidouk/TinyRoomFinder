# TinyRoomFinder

TinyRoomFinder is a student accommodation search app for London.

It asks for:

- the student's university and preferred district;
- a weekly or monthly budget;
- whether they want to live alone or share;
- an email address and preferred monitoring frequency.

The app runs TinyFish browser agents inside the interface to search Zoopla, Rightmove, SpareRoom, OpenRent, StuRents and OnTheMarket. It streams live progress, shows a watchable browser view and renders actual listing prices and links. It also downloads the completed preferences as `student_accommodation_preferences.md`.

## Run locally

The hosted app uses a Cloudflare Worker so the TinyFish API key remains server-side. Set `TINYFISH_API_KEY` in the runtime environment, run `node scripts/build-worker.mjs`, then preview with a Worker-compatible runtime.

## Project files

- `dist/index.html` — app structure
- `dist/styles.css` — responsive visual design
- `dist/app.js` — recommendations, validation, search links and Markdown export
- `scripts/build-worker.mjs` — packages the interface and TinyFish proxy into the Worker entrypoint
- `dist/server/index.js` — generated Cloudflare Worker entrypoint
- `student_accommodation_preferences.md` — blank preference-file template
- `.openai/hosting.json` — private Sites deployment configuration

## Monitoring

The app records the requested email frequency. Recurring searches and email delivery must be activated separately through a connected mail account after the student completes their preferences.

## Safety

Students should verify landlords, tenancy terms, deposit protection, bills and total move-in costs before making a payment.
