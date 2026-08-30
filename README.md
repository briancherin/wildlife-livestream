# Wildlife Wall

A simple fullscreen wildlife livestream display. Currently deployed to https://display.briancher.in/.

The site finds live wildlife cameras from YouTube and automatically rotates between them.


### Local development

Create .dev.vars:

`YOUTUBE_API_KEY=your_youtube_api_key`

Run:

`npx wrangler pages dev .`

Then open:

http://localhost:8788


### Deploy to Cloudflare

Log into Cloudflare:

`wrangler login`

Deploy:

`wrangler pages deploy .`

In the Cloudflare dashboard, add a production secret:

`YOUTUBE_API_KEY`

Then deploy again.