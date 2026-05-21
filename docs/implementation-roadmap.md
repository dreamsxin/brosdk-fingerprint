# Browser Fingerprint Protection Extension Implementation Roadmap

## 1. Delivery Strategy

Build the extension in layers:

1. Extension foundation.
2. Injection and native stealth core.
3. Canvas 2D semantic protection.
4. Audio, WebGL, WebGPU, and Fonts risk-based protection.
5. Stable value and network-header consistency.
6. UI, presets, records, and validation suite.

The native stealth core must land early because every later hook depends on it.

## 2. Phase 0: Project Foundation

Goal: create a maintainable extension skeleton.

Tasks:

- Set up TypeScript + Vite + React extension project.
- Add Manifest V3 configuration.
- Add Chrome/Edge build target.
- Keep Firefox compatibility in mind but do not block Chrome MVP.
- Add `src/background`, `src/content`, `src/injected`, `src/popup`, and `src/shared`.
- Add typed message bus between popup, content script, background, and injected script.
- Add storage schema with migrations.
- Add domain whitelist utility.

Suggested structure:

```txt
src/
  background/
  content/
  injected/
    core/
    modules/
  popup/
  shared/
  types/
docs/
tests/
```

Acceptance:

- Extension loads unpacked in Chrome.
- Popup opens.
- Background can read/write config.
- Content script can send page activity to background.

## 3. Phase 1: Injection Runtime

Goal: reliable main-world installation.

Tasks:

- Implement compatibility injection with `chrome.scripting.executeScript`.
- Implement optional fast injection with `chrome.userScripts`.
- Add permission request flow for `userScripts`.
- Add all-frame support.
- Add same-origin iframe hook installation.
- Add cross-origin iframe coordination when possible through content-level records.
- Add worker injection support for blob workers where feasible.

Acceptance:

- Hook runtime executes before normal page script in fast mode.
- Runtime installs in top window and same-origin iframes.
- Whitelisted domains are skipped.
- Config changes re-register fast-mode script.

## 4. Phase 2: Native Function Stealth Core

Goal: make hook wrappers appear native under common detection techniques.

Modules:

```txt
src/injected/core/stealth/
  index.ts
  native-source.ts
  descriptors.ts
  reflection.ts
  stack.ts
  realm.ts
```

Tasks:

- Capture original references before installing other hooks.
- Implement safe wrapper/proxy factory.
- Preserve `name`, `length`, descriptors, prototype, and `toString` output.
- Hook `Function.prototype.toString`.
- Hide internal symbols and bookkeeping keys from reflection APIs.
- Hook descriptor and key enumeration APIs:
  - `Object.getOwnPropertyNames`
  - `Object.getOwnPropertyDescriptor`
  - `Object.getOwnPropertyDescriptors`
  - `Object.getOwnPropertySymbols`
  - `Reflect.ownKeys`
- Handle `Object.setPrototypeOf` and `Reflect.setPrototypeOf` artifacts.
- Add stack cleanup for known wrapper frames.
- Record native-check signals when suspicious reflection patterns are observed.

Acceptance:

- `Function.prototype.toString.call(CanvasRenderingContext2D.prototype.getImageData)` returns native-looking source after hook.
- Hooked functions keep expected `name` and `length`.
- Internal metadata does not appear in own-key or descriptor enumeration.
- A custom native-check test page cannot trivially detect wrappers through basic checks.

## 5. Phase 3: Canvas 2D Semantic Protection

Goal: protect Canvas 2D fingerprints without perturbing low-risk drawing.

Modules:

```txt
src/injected/modules/canvas2d/
  index.ts
  profile.ts
  path-tracker.ts
  classifier.ts
  perturb.ts
  text.ts
  gradient.ts
  export-hook.ts
  records.ts
```

Tasks:

- Hook `HTMLCanvasElement.prototype.getContext`.
- Track `CanvasRenderingContext2D` to canvas profiles using WeakMaps.
- Track current style state:
  - `fillStyle`
  - `strokeStyle`
  - `font`
  - `textAlign`
  - `textBaseline`
  - `lineWidth`
  - `shadowBlur`
  - `filter`
  - `globalAlpha`
  - `globalCompositeOperation`
  - transform state
- Track path operations:
  - `beginPath`
  - `moveTo`
  - `lineTo`
  - `arc`
  - `arcTo`
  - `ellipse`
  - `bezierCurveTo`
  - `quadraticCurveTo`
  - `rect`
  - `fill`
  - `stroke`
- Classify low-risk operations:
  - pure `fillRect`
  - `clearRect`
  - axis-aligned integer lines
  - plain rectangles
- Classify high-risk operations:
  - text
  - curves
  - gradients
  - patterns
  - images
  - transforms
  - shadow/filter/composite
- Implement parameter perturbation for high-risk drawing.
- Keep `measureText` unmodified by default; rely on `fillText` and `strokeText` perturbation for text rendering protection.
- Implement local export-time pixel perturbation for high-risk profiles as an opt-in mode.
- Keep export-time pixel perturbation disabled by default; prefer drawing-parameter perturbation to reduce anthropogenic-noise detection.
- Hook:
  - `getImageData`
  - `toDataURL`
  - `toBlob`
  - `OffscreenCanvas.convertToBlob`

Acceptance:

- Pure solid-color canvas export is unchanged.
- Horizontal/vertical integer-line canvas export is unchanged.
- Text fingerprint output changes and remains stable by selected seed mode.
- Gradient and curve fingerprint output changes.
- CreepJS or similar Canvas score changes when enabled.
- Normal canvas chart/demo remains visually intact.

## 6. Phase 4: Audio Risk-Based Protection

Goal: perturb offline audio fingerprint paths while preserving real playback.

Modules:

```txt
src/injected/modules/audio/
  index.ts
  profile.ts
  classifier.ts
  perturb.ts
```

Tasks:

- Track `OfflineAudioContext`.
- Track creation of oscillator, compressor, analyser, and buffer source nodes.
- Track `startRendering`.
- Hook readback APIs:
  - `AudioBuffer.getChannelData`
  - `AudioBuffer.copyFromChannel`
  - `AnalyserNode.getFloatFrequencyData`
  - `AnalyserNode.getByteFrequencyData`
- Apply stable sparse perturbation only when risk threshold is met.
- Avoid perturbing silent buffers.
- Avoid repeated perturbation of the same typed array.

Acceptance:

- Offline audio fingerprint output changes.
- HTML audio playback is not audibly affected.
- All-zero buffers remain all-zero.
- Repeated reads of the same rendered buffer are stable.

## 7. Phase 5: WebGL Protection

Goal: normalize high-entropy WebGL metadata and perturb high-risk readback.

Modules:

```txt
src/injected/modules/webgl/
  index.ts
  profile.ts
  parameters.ts
  read-pixels.ts
```

Tasks:

- Hook `getExtension`.
- Hook `getParameter`.
- Hook `getSupportedExtensions`.
- Hook `getShaderPrecisionFormat`.
- Hook `readPixels`.
- Normalize `WEBGL_debug_renderer_info`.
- Bucketize selected limits and precision values.
- Perturb `readPixels` only when risk threshold is met.

Acceptance:

- GPU vendor/renderer can be configured or bucketized.
- Visible WebGL render demos remain visually correct.
- Readback-based fingerprint tests change.
- Metadata values remain plausible and internally consistent.

## 8. Phase 6: WebGPU Protection

Goal: reduce WebGPU entropy without breaking modern rendering.

Modules:

```txt
src/injected/modules/webgpu/
  index.ts
  profile.ts
  capabilities.ts
  readback.ts
```

Tasks:

- Hook `navigator.gpu.requestAdapter`.
- Wrap returned `GPUAdapter`.
- Bucketize `adapter.limits`.
- Normalize `adapter.features` and `adapter.info` where available.
- Track `requestDevice` required features and limits.
- Do not report limits below values already requested by page.
- Track compute/readback behavior:
  - `copyTextureToBuffer`
  - `GPUBuffer.mapAsync`
  - `GPUBuffer.getMappedRange`
- Perturb mapped readback buffers only for high-risk profiles.

Acceptance:

- Basic WebGPU demos continue to render.
- Capability fingerprint values become bucketized.
- Readback fingerprint tests change under high-risk conditions.
- No page failure from reporting limits below requested limits.

## 9. Phase 7: Fonts Protection

Goal: reduce font enumeration entropy while preserving normal layout.

Modules:

```txt
src/injected/modules/fonts/
  index.ts
  dom-measure.ts
  canvas-text.ts
  font-face.ts
```

Tasks:

- Track bulk `measureText` calls.
- Track hidden DOM measurement patterns.
- Hook `HTMLElement.offsetWidth` and `offsetHeight` only under high-risk profiles.
- Hook `Element.getBoundingClientRect` for font-probing contexts.
- Hook `FontFace` constructor for `local(...)` sources.
- Hide a small stable subset of local fonts in privacy preset.

Acceptance:

- Bulk font probing result changes.
- Normal page layout is not visibly shifted.
- Canvas text measurement remains consistent with Canvas text perturbation.

## 10. Phase 8: Stable Value and Network Consistency

Goal: make configured identity values consistent across JS and request headers.

Modules:

```txt
src/injected/modules/stable-values/
  navigator.ts
  timezone.ts
  screen.ts
src/background/request-rules.ts
```

Tasks:

- Implement Navigator values:
  - `userAgent`
  - `userAgentData`
  - `languages`
  - `language`
  - `hardwareConcurrency`
- Implement timezone values:
  - `Date`
  - `Intl.DateTimeFormat`
  - `getTimezoneOffset`
  - locale methods
- Implement conservative screen values:
  - width/height
  - availWidth/availHeight
  - colorDepth/pixelDepth
- Implement `declarativeNetRequest` rules for:
  - `User-Agent`
  - `Sec-CH-UA-*`
  - `Accept-Language`
- Ensure whitelist exclusions apply to request rules.

Acceptance:

- JS UA matches request UA.
- JS Client Hints match `Sec-CH-UA-*`.
- `navigator.languages` matches `Accept-Language`.
- Date and Intl timezone values agree.

## 11. Phase 9: UI and Presets

Goal: expose controls without overwhelming users.

Popup tabs:

- Records
- Protection
- Whitelist
- More

Protection groups:

- Canvas 2D
- Audio
- WebGL
- WebGPU
- Fonts
- Stable values
- Disable features
- Stealth core diagnostics

Presets:

- Balanced
- Privacy
- Compatibility
- Research

Tasks:

- Add import/export JSON config.
- Add remote subscription URL support.
- Add preset application.
- Add per-page records with risk categories.
- Add current-domain whitelist button.
- Add advanced thresholds behind an expert toggle.

Acceptance:

- User can enable/disable protection globally.
- User can whitelist current domain.
- User can select a preset.
- User can see which fingerprint APIs were accessed.
- User can see native-check activity.

## 12. Phase 10: Validation Suite

Goal: continuously prove protection and compatibility.

Test pages:

```txt
tests/pages/
  canvas-solid.html
  canvas-axis-lines.html
  canvas-text.html
  canvas-gradient.html
  canvas-curves.html
  audio-offline.html
  webgl-readpixels.html
  webgpu-readback.html
  fonts-bulk.html
  native-checks.html
```

Automated tests:

- Launch Chrome with extension.
- Load test page.
- Collect fingerprint result.
- Compare enabled vs disabled.
- Compare repeated enabled results for stability.
- Screenshot visual demos for regressions.

External validation:

- BrowserLeaks.
- CreepJS.
- FingerprintJS demo.
- Browserscan.
- WebBrowserTools.

Acceptance:

- Low-risk Canvas pages remain unchanged.
- High-risk Canvas pages change.
- Audio offline fingerprint changes.
- WebGL readback fingerprint changes.
- WebGPU capability/readback fingerprints change where supported.
- Native-check page does not detect hooks through baseline checks.

## 13. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Late injection misses early fingerprint reads | High | Prefer `userScripts` fast mode and warn when unavailable |
| Native-check detection reveals hooks | High | Implement stealth core before protection modules |
| Canvas perturbation breaks visual apps | High | Use semantic risk scoring and leave low-risk drawing untouched |
| Audio perturbation affects playback | Medium | Restrict to offline-render/readback chains |
| WebGPU limits break apps | High | Never report values below page-requested limits |
| Request headers mismatch JS values | High | Centralize identity config and generate both JS and header values from it |
| Cross-realm leakage | Medium | Install hooks in iframes/workers when feasible |
| Overly unique spoofed profile | Medium | Use common buckets and presets instead of arbitrary random values |

## 14. MVP Scope

MVP should include:

- Manifest V3 shell.
- Config storage and whitelist.
- Main-world injection.
- Native stealth core baseline.
- Canvas 2D semantic protection.
- Records and popup.
- Basic test pages for Canvas and native checks.

MVP should not include:

- Full WebGPU readback perturbation.
- Complex remote subscription management.
- Firefox parity.
- Advanced UI threshold editor.

## 15. Suggested Milestones

Milestone 1: Foundation and injection.

- Extension loads.
- Popup works.
- Main-world runtime installs.

Milestone 2: Stealth core.

- Hook wrappers pass baseline native checks.
- Internal metadata hidden.

Milestone 3: Canvas MVP.

- Text, curve, gradient, and export-risk perturbation.
- Pure solid and axis-line no-op tests pass.

Milestone 4: Records and presets.

- Popup records Canvas and native-check activity.
- Balanced, Privacy, Compatibility presets available.

Milestone 5: Audio and WebGL.

- Offline audio perturbation.
- WebGL metadata/readback strategy.

Milestone 6: WebGPU and Fonts.

- WebGPU capability bucketization.
- Font bulk probing protection.

Milestone 7: Stable values.

- Navigator/timezone/language/screen and request-header consistency.

Milestone 8: Hardening.

- External fingerprint sites.
- Regression tests.
- Compatibility review.
