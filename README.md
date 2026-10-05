# TinyRoomFinder

TinyRoomFinder is a student accommodation search app for London.

It asks for:

- the student's university and preferred district;
- a weekly or monthly budget;
- whether they want to live alone or share;
- an email address and preferred monitoring frequency.

The app prepares searches for Zoopla, Rightmove, SpareRoom, OpenRent, StuRents and OnTheMarket. It also downloads the completed preferences as `student_accommodation_preferences.md`.

## Run locally

Serve the `dist` folder with any static web server, then open the local address in a browser.

For example:

```sh
python3 -m http.server 4173 --directory dist
```

## Project files

- `dist/index.html` — app structure
- `dist/styles.css` — responsive visual design
- `dist/app.js` — recommendations, validation, search links and Markdown export
- `student_accommodation_preferences.md` — blank preference-file template
- `.openai/hosting.json` — private Sites deployment configuration

## Monitoring

The app records the requested email frequency. Recurring searches and email delivery must be activated separately through a connected mail account after the student completes their preferences.

## Safety

Students should verify landlords, tenancy terms, deposit protection, bills and total move-in costs before making a payment.
