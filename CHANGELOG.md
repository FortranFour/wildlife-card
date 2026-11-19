# Changelog

## 1.5.0 — 2026-11-19

- **Animals you hear.** With `birdnet_addon` or `birdnet_url` set, a Seen / Heard switch adds the bird and other animal calls identified by [BirdNET-Go](https://github.com/tphakala/birdnet-go): tiles for the commonest callers with its species pictures, the grid by species, time of day or microphone, and a browser that opens each detection on its spectrogram with the recording under it. The headline reports newcomers, callers above or below their usual rate, the busiest hours and what calls after dark. An add-on is read through ingress, so it needs no address of its own; viewers who may not open it get the card without the switch. Nothing changes for a card without either option.
- **A playhead on the spectrogram.** A line crosses the spectrogram at the point being played, and a click on the spectrogram plays from there.
- **Seen and heard together.** With `correlate: true`, a sighting is paired with a call of the same kind of animal, from the microphone that has its camera's name, within `correlate_window` seconds (120 unless set). The switch gains **Both**, which shows only paired sightings, with the call's spectrogram and recording under the camera picture beside BirdNET-Go's picture of the species it named. Paired sightings are marked on the Seen side.
- **A confidence threshold of their own for calls.** `heard_min_score` sets where it opens, the Heard side's slider moves it, and Both shows a slider for each side. `heard_ignore` leaves heard labels out by common or scientific name; BirdNET's classes that are not animals, and dogs, are always left out.
- **A coyote that is heard** leads the Heard headline and is noted on the Seen side, beside the cameras' own inference.
- **Repeat, and sound.** A button on the stage loops a recording or a sighting's video, and is remembered. Clips now start with their sound on, falling back to muted where the browser insists; muting a video yourself is remembered for the next one.
- **"Discover species automatically" is always in the visual editor.** Over a `species` list written in YAML it sets `discover: true`, which discovers species while the list stays in the YAML, and turning it off puts the list back in force.
- **Leaving dogs out of discovery no longer switches off the coyote inference.** With `dog` in `ignore_labels`, dogs were dropped from the request to Frigate, so none was ever weighed as a likely coyote.
- **Over a video, the close button and counter sit in a band above the picture**, clear of the player's own controls, which on the iPhone are in the top corners.
- **A background refresh no longer cuts off a clip or recording that is playing.** The card is redrawn around it.

## 1.4.0 — 2026-11-15

- **Automatic species discovery.** `species: auto` builds the tiles from whatever animals Frigate reports instead of a fixed list, promoting classified sub-labels (a bird classifier's species, SpeciesNet's taxonomy) to tiles of their own. `aliases` renames them, `glyphs` picks their emoji and `ignore_labels` leaves some out. Contributed by mgranberry.
- **Sub-labels in species lists.** A group's `labels` now match a sighting's sub-label as well as its label. Contributed by mgranberry.
- **Clip lead-in and lead-out.** `clip_lead_in` and `clip_lead_out` play extra seconds before and after a sighting, cut from Frigate's recordings, falling back to the event's own clip when the recording is gone. Contributed by mgranberry.
- **Discovery leaves sounds out.** Frigate files audio detections beside tracked objects, so `speech` and `fire_alarm` arrived as tiles. They are now skipped by the event's type rather than by name. A label written into an explicit species list is still shown.
- **The visual editor has a switch for discovery** and, with it on, a picker for labels to leave out, offered from what Frigate has recently reported. The clip padding fields are there too.

## 1.3.5 — 2026-11-15

- **No error under every sighting for viewers who are not administrators.** The Frigate button's address comes from the Supervisor, which answers administrators only. For anyone else (another user of the house, or a visitor to a dashboard published read-only) the card reported "Frigate could not be reached" in a box under the picture. Such a viewer has no Frigate page to open, so the button is now simply left out. A Frigate that is really unreachable still says so.

## 1.3.4 — 2026-11-14

- **Inside the Companion apps the Frigate button opens Home Assistant's own Frigate panel.** 1.3.3 sent the app's view to the ingress address, and the app answered by reloading the frontend, so the tap landed on the default dashboard and never reached Frigate. The panel is the one route known to work there. It opens Frigate's front page rather than the sighting; browsers keep the link to the sighting itself, as does a plain `frigate_url`.

## 1.3.3 — 2026-11-14

- **The Frigate button returned 401 in the Companion apps.** Ingress accepts nothing but a session cookie, and the apps hand a new-tab link to the system browser, which keeps its own cookies — so the link arrived with no session, and the Supervisor's log said as much. Inside the apps an add-on's Frigate now opens in the same view, where the cookie is; go back to return to the dashboard. Desktop browsers and a plain `frigate_url` keep the new tab.
- 1.3.2 blamed this 401 on the picture link. The log shows that was wrong; its signing is harmless and stays.

## 1.3.2 — 2026-11-14

- **Opening the picture in a new tab returned 401.** The frontend keeps its token in script rather than in a cookie, so none of Home Assistant's credentials travel to a tab opened beside it, and a bare proxy address arrives unauthenticated. Inside the card the pictures still appear because a failed load quietly retries through a signed path; a link has no such second chance. The link now carries the signed path from the start, which satisfies the proxy whether or not it demands authentication, and settles the notification proxy's expiry option at the same time.

## 1.3.1 — 2026-11-14

- **The Frigate button did nothing in the iOS Companion app.** It opened a blank tab, resolved the address, then navigated that tab — and the app's web view never arrives at a tab that script opened and then sent somewhere after an await. The same shape of problem as the clips. It is now an ordinary link with its address already in place, which is why the snapshot arrow beside it always worked.
- The address is therefore resolved when a sighting is drawn rather than when the button is tapped, and kept for ten minutes so a token reissued by an add-on restart is picked up without storing it. A Frigate that cannot be reached now offers no link and says so, instead of a link that goes nowhere.

## 1.3.0 — 2026-11-14

- **The open button offers the picture, not the clip.** It used to hand the browser Frigate's `clip.mp4` whenever a sighting had one, which on an iPhone opens the player that refuses that file: Frigate serves it without byte-range support, and Apple's player answers by fetching the whole thing over and over and discarding each copy. In the card a clip plays because hls.js is doing the work; a new tab has no such help. The button now opens the snapshot, which every browser on every platform can show, and clips stay with the player that can play them.
- **A button that opens the sighting in Frigate**, off unless you configure it. It lands on the Explore view with that tracked object selected, which is where its lifecycle, its labels and — for Frigate+ subscribers — submission live.
- Behind ingress the token in the address is reissued whenever the add-on restarts, so `frigate_addon` takes the add-on's slug and the card reads the current address when you tap, mints a session the way Home Assistant's own add-on panel does, and never stores either. `frigate_url` covers a Frigate that runs outside the Supervisor.

## 1.2.0 — 2026-11-13

- **A visual editor.** Pick the card from the dashboard's card picker and everything but the species groups is a form: title, icon, opening range and confidence, refresh interval, day/night shading, indoor cameras, Frigate instance, and the coyote settings behind a fold. It is built on Home Assistant's own `ha-form`, so it matches the built-in editors rather than approximating them.
- The camera pickers offer the names **Frigate** uses, read from recent events, because guessing them from entity ids gets the capitalisation wrong and the names are matched exactly when querying. Typing a name that has not been seen lately still works.
- Species groups stay in YAML — they are a list of lists, and a form makes them harder to read rather than easier. The editor carries them, the card type and any wrapper's own keys through every change untouched, so switching between the form and YAML loses nothing.

## 1.1.1 — 2026-11-12

- **Every Monday column was narrower than the rest.** The weekly marker was a left margin on the cell, so it took its 2px out of the cell rather than the gap — 5px against 7px on a 30-day phone view, which is a third narrower and plainly visible. The marker is now a hairline drawn in the gap and all columns are identical. The tests measure them.

## 1.1.0 — 2026-11-12

- **Day/night shading on the time-of-day rows.** A faint strip beside the time labels and a wash behind the cells show at a glance whether a sighting was in daylight, darkness, dawn or dusk. Every column uses its own date, so across a 30-day range you can watch the nights draw in.
- The shading comes from the sun's altitude at your latitude, computed in the card, so there is nothing to configure beyond having a location set in Home Assistant — and no dependency on the sun entity, which only knows about today. Each two-hour cell is sampled every half hour and the colours blended, so a cell straddling sunrise comes out part night, part dawn. Dawn and dusk are identical as far as the sun is concerned, so they are told apart by whether it is on its way up.
- Light and dark themes get their own palettes: a warm daylight tint turns olive over a dark surface, so the dark theme uses a paler, cooler day.
- Turn it off with `sun_shading: false`. It also skips itself when no latitude is set.
- The time labels now line up on the dash, so `10a – 12p` and `2a – 4a` share a vertical edge instead of stepping in and out.

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
