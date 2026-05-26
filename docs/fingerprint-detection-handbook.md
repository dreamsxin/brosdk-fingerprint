# Browser Fingerprint Detection Handbook

## 1. Purpose

This handbook summarizes how modern fingerprint detection usually identifies browser fingerprint protection, and how this project should design probes, mitigations, and validation pages.

The central idea is that fingerprint detection has two broad classes:

1. Wrong rendering or wrong API behavior.
2. Rendering or API results outside large real-world datasets.

The first class can be detected with local rules. The second class depends on population statistics and cross-surface consistency.

## 2. Detection Model

### 2.1 Wrong Rendering

Wrong rendering means the result violates normal browser or graphics behavior. A detector does not need a large dataset for this class. It only needs invariant checks.

Examples:

- Blank canvas pixel is not `[0, 0, 0, 0]`.
- `putImageData` writes `[201, 33, 77, 255]`, but `getImageData` reads a different value.
- A single opaque `fillRect(0, 0, 1, 1)` pixel is altered.
- A solid-color rectangle contains multiple colors.
- Integer horizontal or vertical lines have unexpected antialiasing.
- The same canvas returns different results across repeated `getImageData` or `toDataURL`.
- A data URL drawn back with `drawImage` differs from the original canvas.
- A pseudo-gradient made from deterministic solid-color sectors has drifting color count or histogram.
- Native methods expose hook artifacts through `toString`, `name`, `length`, descriptors, own properties, exception shape, or stack traces.

This class is high priority because it catches crude noise immediately.

Design rule:

- Do not perturb deterministic low-entropy rendering.
- Preserve blank, solid color, single-pixel, `putImageData`, and integer axis-line behavior.
- Only perturb surfaces where real browser entropy appears, such as text antialiasing, curves, gradients, scaling, alpha blending, and image composition.

### 2.2 Outside Real-World Dataset

Outside-dataset detection means the result is internally valid but statistically unlikely.

A detector can compare outputs against known populations such as:

- Chrome + Windows + NVIDIA.
- Chrome + Windows + Intel.
- Edge + Windows + AMD.
- Safari + macOS + Apple GPU.
- Firefox + Linux + Mesa.
- Mobile Safari + iOS device classes.

Examples:

- Canvas hash is unique or too rare for the claimed browser, OS, GPU, and font stack.
- Noise appears uniformly across pixels instead of only at antialiasing boundaries.
- Pure color regions have low-bit noise, which real renderers usually do not produce.
- Canvas, WebGL renderer, font metrics, UA, platform, and screen values point to incompatible device classes.
- Audio fingerprint is stable but does not match the claimed browser and OS family.
- WebGPU limits are valid individually but form an impossible adapter profile.

This class is harder to test locally because it needs a dataset. The local test suite should still record enough metrics to compare later.

Design rule:

- Prefer semantic perturbation over global pixel noise.
- Keep values stable for a domain or configured seed mode.
- Keep all surfaces internally consistent.
- Avoid producing one-off hashes that no real device class would produce.

## 3. Canvas 2D Detection

### 3.1 Low-Entropy Invariants

These should normally remain exact:

- Blank transparent canvas.
- Single opaque pixel.
- `putImageData` exact pixel write and readback.
- Solid-color rectangles.
- Integer-coordinate horizontal and vertical lines.
- Simple non-transformed rectangles without shadow, filter, alpha blending, composite mode, gradient, or pattern.

Local probes:

- `canvas single-pixel exact readback`.
- `blank canvas unchanged`.
- `solid color low entropy`.

### 3.2 High-Entropy Sources

These are legitimate entropy sources and can be protected more aggressively:

- Text rendering, font hinting, emoji, CJK text.
- Curves, arcs, ellipses, Bezier paths.
- Gradients.
- `drawImage`, especially scaling or drawing from video, SVG, canvas, or data URL.
- Alpha blending, shadows, filters, and non-default composite modes.

Local probes:

- `canvas read stability`.
- `leakdig 260x30 fingerprint stability`.
- `leakdig complex canvas statistics`.
- `leakdig drawImage dataURL pixel consistency`.

### 3.3 Pseudo-Gradient Ring vs True Gradient Ring

Pseudo-gradient ring:

- Built from deterministic solid-color arc sectors.
- Color count and histogram should be stable for the same browser environment.
- It is useful for detecting wrong perturbation because each sector is explicitly colored.

True gradient ring:

- Built with `CanvasGradient`, preferably `createConicGradient`.
- Color count is browser and renderer dependent.
- The exact number of colors should be recorded, not treated as a universal expected value.
- Repeated readback should remain stable in the same environment.

Local probe:

- `canvas ring pseudo-gradient vs true-gradient`.

Expected behavior:

- Pseudo-gradient: stable data URL, pixel hash, color count, and histogram.
- True gradient: stable repeated readback, but no fixed cross-device color-count baseline.
- Pseudo and true gradient results should differ.

### 3.4 Canvas Protection Implications

Canvas protection should:

- Avoid touching low-entropy deterministic drawing.
- Track semantic risk during drawing.
- Prefer drawing-parameter perturbation for text, curves, gradients, and image composition.
- Keep export-time pixel noise off by default because it is easy to classify as anthropogenic plugin noise.
- If pixel noise is enabled, only apply it to high-risk profiles and only in plausible regions.

## 4. Audio Detection

### 4.1 Wrong Audio Behavior

Examples:

- Offline rendering is unstable across repeated runs.
- `AudioBuffer.getChannelData` and `copyFromChannel` disagree.
- Analyser output contains impossible values.
- Real-time playback is audibly affected.
- Native audio methods expose hook artifacts.

Local probes:

- Offline oscillator plus compressor render.
- Repeated buffer hash comparison.
- `getChannelData` and `copyFromChannel` consistency.
- Native check for `AudioBuffer`, `AnalyserNode`, `OfflineAudioContext`, and `DynamicsCompressorNode`.

### 4.2 Outside-Dataset Audio Behavior

Examples:

- Offline audio hash does not match claimed browser and OS class.
- Noise distribution looks injected rather than floating-point DSP variance.
- Audio output conflicts with UA and platform.

Protection implications:

- Focus on offline fingerprint chains, not real playback.
- Perturb extracted fingerprint buffers only when risk score is high.
- Keep perturbation deterministic by seed and domain.
- Avoid broad real-time audio mutation.

## 5. WebGL Detection

### 5.1 Wrong WebGL Behavior

Examples:

- `getParameter` returns values with impossible types or ranges.
- `WEBGL_debug_renderer_info` exposes inconsistent vendor and renderer.
- `getSupportedExtensions` changes across calls.
- `readPixels` is unstable for a deterministic scene.
- Shader precision values are malformed.
- WebGL native methods expose hook artifacts.

Local probes:

- `webgl consistency`.
- `webgl-readpixels.html`.
- `leakdig webgl info hook timing`.

### 5.2 Outside-Dataset WebGL Behavior

Examples:

- Renderer string, max texture size, precision, and extension list do not match known GPU/browser classes.
- WebGL renderer conflicts with UA platform or WebGPU adapter.
- Readback hash is unique for the claimed device class.

Protection implications:

- Bucket metadata into plausible device classes.
- Keep WebGL and WebGPU profiles consistent.
- Apply readback perturbation only for high-risk small fingerprint scenes.
- Avoid perturbing games, maps, CAD, and long-running 3D apps unless explicitly configured.

## 6. WebGPU Detection

### 6.1 Wrong WebGPU Behavior

Examples:

- `navigator.gpu` exists in an incompatible browser profile.
- `requestAdapter` is non-native or throws unusual errors.
- Adapter limits are impossible.
- Feature sets are empty or inconsistent with limits.

Local probes:

- `webgpu capability surface`.

### 6.2 Outside-Dataset WebGPU Behavior

Examples:

- Limits and features do not match known Chrome, OS, and GPU combinations.
- WebGPU adapter conflicts with WebGL unmasked renderer.

Protection implications:

- Prefer capability bucketization.
- Keep adapter profile coherent with WebGL and UA.
- Avoid readback perturbation until the fingerprint scene is clearly high risk.

## 7. Font Detection

### 7.1 Wrong Font Behavior

Examples:

- `measureText` is unstable for repeated calls.
- `FontFace("x", "local(...)")` has non-native behavior.
- Canvas text metrics conflict with rendered text pixels.
- Native methods expose hook artifacts.

Local probes:

- `font probing surface`.
- Bulk measurement across common fonts and fallback families.

### 7.2 Outside-Dataset Font Behavior

Examples:

- Claimed OS lacks expected system fonts.
- Too many or too few fonts are detectable.
- Emoji, CJK, and fallback behavior conflict with platform.

Protection implications:

- Detect bulk probing rather than single normal text operations.
- Optionally hide a small stable subset of local fonts.
- Keep font behavior consistent with UA, platform, and language.

## 8. Navigator, Screen, Timezone, and Permissions

### 8.1 Wrong API Behavior

Examples:

- `navigator.webdriver === true`.
- `navigator.languages` is empty.
- UA and UA-CH platform disagree.
- `screen.availWidth > screen.width`.
- `colorDepth !== pixelDepth` in a profile where they should match.
- `Date.getTimezoneOffset` disagrees with `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Permission states throw unusual errors or expose automation.

Local probes:

- `navigator consistency`.
- `screen consistency`.
- `timezone consistency`.
- `permissions surface`.

### 8.2 Outside-Dataset API Behavior

Examples:

- Screen size, DPR, platform, and device memory form an unlikely device.
- Timezone and language do not match common locale patterns.
- UA-CH brands or high-entropy values do not match UA.
- Hardware concurrency and device memory are rare for the claimed device.

Protection implications:

- Use stable configured values.
- Keep JS API values consistent with network headers.
- Avoid dynamic risk-based changes for identity values such as UA, language, timezone, and screen.

## 9. Native Hook Detection

Common checks:

- `Function.prototype.toString.call(fn)`.
- Direct `fn.toString()`.
- Function `name` and `length`.
- Property descriptors.
- Own properties on functions or prototypes.
- `Object.keys`, `Object.getOwnPropertyNames`, `Reflect.ownKeys`.
- Calling methods with invalid receivers and comparing exception shape.
- Proxy stack traces such as `Proxy.` in errors.
- Clean iframe comparison.
- Early snapshot before extension installation.

Protection implications:

- Install as early as possible.
- Preserve prototype method references where feasible.
- Use a stealth core before installing module hooks.
- Keep wrapper metadata and native string behavior coherent.
- Avoid broad proxying of every property.

## 10. Test Page Map

Current local test pages:

- `tests/pages/leakdig-canvas-abnormal.html`
  - Canvas native checks.
  - Canvas stability.
  - Single-pixel exact readback.
  - Solid color and blank canvas invariants.
  - Pseudo-gradient and true-gradient ring checks.
  - Leakdig-style Canvas probes.
  - Canvas data URL and drawImage replay checks.

- `tests/pages/fingerprint-surfaces.html`
  - Navigator, screen, timezone, permissions.
  - Offline audio stability.
  - WebGL metadata and readback.
  - WebGPU capability surface.
  - Font probing surface.
  - Native and proxy hook checks outside Canvas.

- `tests/pages/webgl-readpixels.html`
  - Focused WebGL readback test.

- `tests/pages/canvas-basic.html`
  - Basic Canvas behavior.

- `tests/pages/canvas-stability.html`
  - Repeated Canvas hash stability.

## 11. Multi-Task Refinement Plan

### Task A: Canvas Invariant Suite

Goal:

- Prove that low-entropy deterministic Canvas operations remain exact.

Checks:

- Blank canvas.
- Single pixel.
- Solid rectangles.
- Axis-aligned integer lines.
- `putImageData`.
- Pseudo-gradient ring.

Acceptance:

- Clean browser passes.
- Extension default mode passes low-entropy invariants.
- High-risk Canvas probes still change when protection is enabled.

### Task B: Canvas High-Entropy Suite

Goal:

- Validate semantic perturbation of high-entropy Canvas operations.

Checks:

- Text, emoji, CJK.
- Curves and Beziers.
- True gradients.
- `drawImage` scaling and replay.
- Alpha and composite operations.

Acceptance:

- Repeated output is stable in the same seed mode.
- Cross-domain seed mode changes output.
- Perturbation does not affect deterministic low-entropy tests.

### Task C: Audio Suite

Goal:

- Validate offline audio fingerprint protection.

Checks:

- Oscillator plus compressor render.
- Buffer readback stability.
- Analyser output stability.
- Real playback non-interference.

Acceptance:

- Clean browser stable.
- Protected offline chain changes deterministically when enabled.
- Normal playback is not modified.

### Task D: WebGL and WebGPU Suite

Goal:

- Validate metadata consistency and readback behavior.

Checks:

- WebGL renderer, vendor, precision, extension list.
- WebGL readPixels deterministic scenes.
- WebGPU adapter limits and features.
- Cross-check WebGL and WebGPU device class.

Acceptance:

- Clean browser stable.
- Protected metadata belongs to plausible buckets.
- High-risk readback changes deterministically when enabled.

### Task E: Fonts Suite

Goal:

- Validate bulk font probing detection and compatibility.

Checks:

- Common font width matrix.
- `FontFace local(...)`.
- Emoji and CJK fallback.
- Repeated `measureText` stability.

Acceptance:

- Normal text measurement remains stable.
- Bulk probing can be recorded.
- Optional font hiding is stable by seed.

### Task F: Identity Consistency Suite

Goal:

- Validate navigator, headers, screen, timezone, and locale consistency.

Checks:

- UA and UA-CH.
- Accept-Language and `navigator.languages`.
- Timezone and Date offsets.
- Screen and DPR.
- Hardware concurrency and memory buckets.

Acceptance:

- Values are stable.
- Values do not contradict each other.
- Header and JavaScript surfaces agree where extension permissions allow.

## 12. Practical Guidance

When a site reports Canvas abnormal, first classify the reason:

1. Did the output violate an invariant?
   - Check single pixel, blank canvas, solid color, axis lines, `putImageData`, repeated readback.
   - If yes, fix the perturbation logic before changing spoof values.

2. Is the output valid but rare?
   - Compare Canvas with WebGL renderer, fonts, UA, platform, DPR, and OS class.
   - If yes, reduce anthropogenic noise and move toward plausible semantic perturbation.

3. Was the hook detected rather than the rendered value?
   - Check native strings, descriptors, function references, proxy stack traces, and iframe comparison.
   - If yes, improve the stealth core or injection timing.

The safest default is conservative:

- Do not perturb low-risk drawing.
- Record suspicious use.
- Perturb only high-entropy, fingerprint-like paths.
- Keep results deterministic within the selected seed mode.
- Keep all fingerprint surfaces coherent.
