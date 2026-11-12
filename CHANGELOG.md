# Changelog

## 1.0.3 — 2026-11-11

- **Clips play through hls.js**, loaded only the first time a clip is opened. Apple's native player rejected recordings outright — asking for the same 11 MB segment nine times in eight seconds and discarding each complete copy — while Home Assistant's own media browser played the same event, from the same server, over the same connection. The difference was the player, so the card now uses the same library the media browser does.
- The sources are tried in order: hls.js, then the browser's own HLS, then the MP4, then the notice. Each step falls to the next on failure, so a setup where any one of them works keeps working.
- The MP4 is now the last resort rather than the default on most browsers. Frigate serves it without byte-range support, so seeking in a long clip never worked well through it.

## 1.0.2 — 2026-11-11

- **Clips play over HLS where the browser handles it natively** (Safari and the iOS Companion app), using the event stream the Frigate integration serves from the same proxy as the file, and falling back to the MP4 if that fails. Apple devices refuse MP4s that every other browser plays, for reasons that vary — a codec, a range request, a content type — and HLS is the path Frigate's own interface uses, so this routes around the question rather than guessing at it.
- The notice no longer blames H.265 when a clip will not play. An H.264 recording with AAC audio fails the same way, so it now says the format or the delivery was refused and points at the file, which says more.

## 1.0.1 — 2026-11-11

- A clip the browser will not play now says so, instead of leaving a black box. The notice names the failure — interrupted, not fetched, could not be decoded, format not supported — and offers a link to the file itself. The last of those is what an H.265 recording looks like on an Apple device, where Safari and the iOS Companion app refuse a file that other browsers play.
- The video element preloads metadata only, so opening a sighting no longer starts pulling the whole clip before anything is tapped.

## 1.0.0 — 2026-11-11

First release.

- **Species tiles.** Rodents, cats, rabbits, birds, raccoons, coyotes, squirrels and a combined *Others* (fox, skunk, possum, snake). Each tile carries the best-scoring recent picture, the count for the period and the time since the last sighting, and filters the rest of the card when tapped. The `species` option replaces the whole list.
- **Activity grid.** Days across, with rows by species, two-hour block or camera. Each species row is scaled to itself so a rare animal is not flattened by the birds; the time and camera views share one scale. Tapping a cell filters the browser to that day and row.
- **Sightings browser.** Filmstrip newest-first, snapshot with previous/next, the clip where one exists, and an open-in-new-tab link. Confidence, camera, zones and duration are shown per sighting.
- **Trend headline.** Which species are running above or below their own rate over the last 3 days, the counts behind it, the cat–rodent correlation, and where and when rodents concentrate. A likely coyote pack in the last 48 hours or a rodent on an indoor camera takes precedence and turns the icon red.
- **Coyote inference.** A `dog` on chosen cameras inside a night window, with no `person` tracked nearby in time, is reported as a likely coyote; overlapping tracks are flagged as a pack. Frigate+ lists `coyote` only as a candidate label, so nothing detects one today. Inferred sightings are always labelled as likely and show their real confidence as a dog.
- **Confidence filter**, behind the tune icon, with a count of what it is hiding. Range, row mode and confidence are remembered per browser.
- No helper entities or YAML packages: tracked objects are read from the Frigate integration's websocket API, and media from its notification proxy, falling back to signed paths.
