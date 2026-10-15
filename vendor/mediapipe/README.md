# Vendored MediaPipe hand landmark detection

- `vision_bundle.mjs`, `wasm/vision_wasm_internal.{js,wasm}`: `@mediapipe/tasks-vision` 1.0.1 from npm
  (Apache-2.0, https://github.com/google-ai-edge/mediapipe, licence text in `LICENSE`). Only the SIMD WASM build is kept.
- `hand_landmarker.task`: MediaPipe Hand Landmarker model, float16 v1, from
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
  (Apache-2.0, model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf).

Loaded only when the user clicks "Detect" in the photo dialog; everything runs in the browser.
