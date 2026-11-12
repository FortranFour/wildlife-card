# Changelog

## 1.0.0 — 2026-11-11

First release.

- **Species tiles.** Rodents, cats, rabbits, birds, raccoons, coyotes, squirrels and a combined *Others* (fox, skunk, possum, snake). Each tile carries the best-scoring recent picture, the count for the period and the time since the last sighting, and filters the rest of the card when tapped. The `species` option replaces the whole list.
- **Activity grid.** Days across, with rows by species, two-hour block or camera. Each species row is scaled to itself so a rare animal is not flattened by the birds; the time and camera views share one scale. Tapping a cell filters the browser to that day and row.
- **Sightings browser.** Filmstrip newest-first, snapshot with previous/next, the clip where one exists, and an open-in-new-tab link. Confidence, camera, zones and duration are shown per sighting.
- **Trend headline.** Which species are running above or below their own rate over the last 3 days, the counts behind it, the cat–rodent correlation, and where and when rodents concentrate. A likely coyote pack in the last 48 hours or a rodent on an indoor camera takes precedence and turns the icon red.
- **Coyote inference.** A `dog` on chosen cameras inside a night window, with no `person` tracked nearby in time, is reported as a likely coyote; overlapping tracks are flagged as a pack. Frigate+ lists `coyote` only as a candidate label, so nothing detects one today. Inferred sightings are always labelled as likely and show their real confidence as a dog.
- **Confidence filter**, behind the tune icon, with a count of what it is hiding. Range, row mode and confidence are remembered per browser.
- No helper entities or YAML packages: tracked objects are read from the Frigate integration's websocket API, and media from its notification proxy, falling back to signed paths.
