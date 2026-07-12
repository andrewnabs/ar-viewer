# ATC AR Viewer

A standalone WebAR page that turns a 2-D radar scenario into a **3-D augmented-reality
air situation** on a phone. It runs entirely in the mobile browser (iOS Safari + Android
Chrome) — no app install — using [MindAR](https://github.com/hiukim/mind-ar-js) for
camera image-tracking and [three.js](https://threejs.org/) for the 3-D scene.

The kiosk (TradeShowApp) shows a QR code on any AR-enabled image. A visitor scans it,
points their phone at the radar screen, and the air picture rises into a ~0.5 m airspace
box: the radar plan is the floor, altitude is up, the top of the box is 45,000 ft, and
every aircraft has a marker, a drop-line to the ground, and a callsign / flight-level label.

```
ar-viewer/
├── index.html        ← the page (self-contained; loads app.js + vendored libs)
├── app.js            ← scene decode, MindAR tracking, 3-D scene, gestures
├── vendor/           ← three.js + mind-ar, committed so there is no CDN dependency
├── scenes/           ← sample scene JSON (scenario1) for local testing
├── targets/          ← MindAR tracking target(s) — see "Compile the target" below
└── serve.mjs         ← tiny static server for local preview only
```

## How a scene reaches the viewer

The kiosk builds a QR pointing at `https://<your-pages-url>/#s=<base64url-json>`. The
JSON is the scene (aircraft list). The viewer reads the hash, no backend needed — which
is why it works on a visitor's phone over cellular even though the kiosk itself is offline.

Scene shape:

```json
{
  "topFt": 45000,
  "aircraft": [
    { "cs": "BAW123", "x": 0.50, "y": 0.40, "ft": 37000, "c": "g", "tgt": 33000 }
  ]
}
```

- `cs` callsign · `x`,`y` position as a 0–1 fraction of the radar image
  (0,0 = top-left) · `ft` flight level in feet · `tgt` (optional) cleared level
- `c` colour: `g` green · `w` white/selected · `c` cyan · `b` blue · `y` grey

For local testing you can also load a bundled scene with `?scene=scenario1`.

## Compile the tracking target (one-time, per radar image)

MindAR needs a compiled `.mind` file for the image it tracks.

1. Open the official compiler: <https://hiukim.github.io/mind-ar-js-doc/tools/compile>
2. Drag in `../data/media/1783821589507_scenario1.png` (the radar image).
3. Click **Start**, then **Download** — you get `targets.mind`.
4. Save it here as `targets/scenario1.mind`.

> **Tracking-quality note.** MindAR tracks best on flat, high-contrast, feature-rich
> images. A dark radar picture on a glossy 85″ screen is a *hard* target (sparse features,
> glare, brightness). Expect some jitter. Two ways to make it rock-solid at the stand:
> - Print a small **marker card** (a busy, high-contrast graphic) and compile *that*
>   instead — the 3-D box then locks to the card and visitors can hold/turn it.
> - The viewer always offers a **"Place it in front of me"** fallback that needs no
>   target at all, so the experience never dead-ends if tracking is poor.

## Deploy to GitHub Pages

1. Create a repo (e.g. `atc-ar`) and copy the **contents of this `ar-viewer/` folder**
   into it (include `vendor/`, `scenes/`, `targets/`; you do **not** need `node_modules/`
   or `serve.mjs`).
2. Push to GitHub → repo **Settings → Pages → Build from branch → `main` / root**.
3. Your public URL is `https://<user>.github.io/atc-ar/`.
4. In the kiosk admin: **Setup → Appearance & behaviour → AR viewer URL** = that URL.
   That's the base the QR codes are built from.

The libraries are vendored under `vendor/`, so the deployed page has **no external
dependency** — it loads only from your Pages URL. (The phone still needs internet to
fetch the page and its ~5 MB of assets the first time.)

## Local preview

```
node serve.mjs           # then open http://localhost:5178/?scene=scenario1
```

Tracked AR needs a real camera + HTTPS, so on desktop use the
**"Place it in front of me"** button to see the 3-D scene.

## Roadmap (future)

The scene format already carries `tgt` (cleared level) per aircraft. Moving tracks and
coloured route legs would extend the scene to a timed series of positions and a `route`
polyline per aircraft; the viewer's per-aircraft group is structured to animate.
