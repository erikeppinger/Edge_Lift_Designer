# Edge Lift Designer

A browser tool that designs a 3D-printable **unlevel edge** for edge lifts (block pulls): a flat
plate with a pocket whose edge steps per finger, fitted to your own hand. Export it as STL or as
3MF with print settings for PrusaSlicer, OrcaSlicer and Bambu Studio.

The idea: on a level edge the shorter fingers (often the little finger) can't load as evenly as the
others. Here each finger's edge height follows the length of its proximal phalanx (MCP → PIP), so
all four fingers meet the edge in the same position. The plate shape follows the familiar
lift-block layout: a rounded frame, printed pocket-up, with cord holes in the side bars.

**Open it: https://erikeppinger.github.io/Edge_Lift_Designer/**

Everything runs in your browser. Measurements and photos never leave your device.

## Features

- **Hand measurement**: type the values in, or take them from a photo with a ruler in it
  (palm, half-fist or back of the hand). Click the points yourself or let "Detect hand" place them
  (MediaPipe Hand Landmarker, runs locally, loaded only when used), then drag them into place.
- **One or two hands**: one stepped edge with a straight opposite border, or a stepped edge per hand
  opposite each other, each from that hand's own data.
- **Edge**: depth, front radius, floor thickness, step angle and step rounding, pocket size.
- **Frame**: bar depth, side bars, rounded corners, outer bar edge bowed outwards or inwards.
- **Cord holes**: teardrop (narrow end towards the load, so the cord cinches), lens for two edges,
  or plain.
- **Print-friendly**: 45° chamfer of N layers on both faces against elephant foot, rounded XY edges,
  no supports needed.
- **3MF with settings**: layer height, walls, infill and pattern, top/bottom layers, optional
  denser-infill zones around the load paths.
- **Checks**: bending and side-bar stress with a safety factor, filament estimate, bed-size warnings
  and readable messages when a combination can't be built.

## Run it locally

No build step, no dependencies. Serve the folder and open it in a browser:

```
npm start
```

then open http://localhost:8095. Any static file server works (ES modules need `http://`, not
`file://`).

## Development

```
npm test        # unit tests (geometry, hand, photo measuring, syntax of every module)
npm run fuzz    # builds 400 random and extreme designs, reports crashes and open meshes
node tools/slice-check.mjs out   # exports cases and slices them with the PrusaSlicer CLI
```

`tools/bambu-presets.mjs` regenerates `js/bambu-presets.js` from a local Bambu Studio install.

## Background

Shaping an edge to the different finger lengths is not new; it has come up over the years from
several sides: climbers' home-made edges, clinicians working with finger injuries (Tyler Nelson
among the most visible), commercial boards such as the MetacarpEdge and Tension's Ergo Edge, and
open 3D-print designs on Printables and MakerWorld. Evidence that an unlevel edge loads the fingers
more evenly is still thin, so treat it as a training option, not a proven fix.

## Credits

- Plate layout inspired by the
  [Ergo Block](https://makerworld.com/en/models/1241056-ergo-block-unlevel-edge-portable-hangboard)
  by 3D_Climber on MakerWorld (sized models in fixed hand sizes). This tool generates its own
  geometry from your measurements; no files of the Ergo Block are included.
- Hand detection: [MediaPipe](https://github.com/google-ai-edge/mediapipe) tasks-vision and Hand
  Landmarker model (Apache-2.0), vendored in `vendor/mediapipe`.

Print and train at your own risk: check the strength readout, print with enough walls and
inspect the part before loading it.

## Licence

MIT, see [LICENSE](LICENSE). The vendored MediaPipe files keep their Apache-2.0 licence
([vendor/mediapipe/LICENSE](vendor/mediapipe/LICENSE)).
