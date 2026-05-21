# Browser Fingerprint Protection Extension Product Design

## 1. Product Positioning

This project is a browser fingerprint protection extension focused on low-breakage, behavior-aware API protection.

The product should not blindly add noise to every fingerprint API result. Instead, it should detect whether a page is performing fingerprint-like operations and apply stable, minimal, semantically appropriate perturbation only to high-risk paths.

Primary goals:

- Reduce fingerprint stability across websites.
- Preserve normal website behavior as much as possible.
- Keep values internally consistent across JavaScript APIs and network headers.
- Provide transparent user controls, whitelist management, and per-page activity records.
- Resist common extension and hook detection techniques, especially checks that modified functions are not native.

Non-goals for the first version:

- Full anti-detect browser replacement.
- TLS, TCP, GPU driver, OS kernel, or browser engine level spoofing.
- Circumventing browser same-origin security restrictions.

## 2. User Value

Target users:

- Privacy-conscious users who want protection against cross-site fingerprint tracking.
- Developers and researchers testing browser fingerprint behavior.
- Teams building browser SDK or automation environments that need configurable fingerprint surfaces.

Core value:

- The extension provides practical fingerprint protection with lower compatibility risk than global random noise.
- It explains what fingerprint APIs were accessed on the current page.
- It lets users choose between privacy-first randomization and compatibility-first stable spoofing.

## 3. Product Capabilities

### 3.1 Extension Shell

The extension uses Manifest V3.

Main components:

- Background service worker: configuration, storage, injection management, badge state, request header rules.
- Content script: page-to-extension message bridge and per-tab activity record collector.
- Main-world injected script: core API hooks and protection logic.
- Popup UI: enable switch, current-site whitelist control, protection records, configuration panels, import/export, presets.
- Optional options page: advanced strategy tuning and debug diagnostics.

### 3.2 Injection Modes

Two injection modes are supported:

- Compatibility mode: inject with `chrome.scripting.executeScript` into `MAIN` world during tab loading.
- Fast mode: register with `chrome.userScripts` at `document_start` when permission is available.

Fast mode should be recommended because it reduces the chance that page scripts read native APIs before protection is installed.

### 3.3 Whitelist

Whitelist behavior:

- Whitelisted domains should not receive main-world hooks.
- Network header rewriting should exclude whitelisted initiator domains and tabs.
- Parent-domain matching is supported, for example `example.com` also matching subdomains when configured.

### 3.4 Records and Badge

The extension records:

- Which fingerprint API families were accessed.
- Whether access was low-risk or high-risk.
- Which iframe origins triggered fingerprint APIs.
- Whether native-function checks were observed.

Badge behavior:

- No badge: no protected API activity.
- Low-risk badge: weak or value-only APIs accessed.
- High-risk badge: Canvas, Audio, WebGL, WebGPU, Fonts, or native-check detection triggered.

## 4. Protection Model

Protection modules are grouped into three categories.

```ts
enum ProtectionKind {
  SemanticNoise = "semantic-noise",
  StableValue = "stable-value",
  DisableFeature = "disable-feature"
}
```

Semantic noise modules:

- Canvas 2D
- Audio
- WebGL
- WebGPU
- Fonts

Stable value modules:

- Navigator
- User-Agent Client Hints
- Language
- Timezone
- Screen
- GPU metadata

Disable feature modules:

- WebRTC
- Service Worker registration

## 5. Seed Strategy

All perturbation must be deterministic within its selected mode.

Supported modes:

- `default`: use original browser value.
- `value`: use user-provided value.
- `page`: random per top-level page load.
- `domain`: stable by registrable domain.
- `browser`: stable for current browser session.
- `global`: stable by user-provided global seed.
- `enabled`: enable feature behavior.
- `disabled`: disable feature behavior.

Recommended defaults:

- Canvas 2D: `domain` for compatibility, `page` for stronger privacy preset.
- Audio: `domain`, only on high-risk offline-render paths.
- WebGL: `domain`, parameter bucketization plus risk-based readback noise.
- WebGPU: `domain`, capability bucketization plus risk-based readback noise.
- Fonts: `domain`, only on bulk measurement or local-font probing.
- Navigator, language, timezone, screen: stable configured values only.

## 6. Canvas 2D Design

Canvas 2D is the priority module.

The module should track drawing semantics before perturbing output. Each canvas/context receives a profile.

```ts
type Canvas2DProfile = {
  riskScore: number
  hasText: boolean
  hasGradient: boolean
  hasPattern: boolean
  hasCurve: boolean
  hasImage: boolean
  hasTransform: boolean
  hasShadow: boolean
  hasComposite: boolean
  hasAntialiasShape: boolean
  hasOnlySolidFill: boolean
  hasOnlyAxisAlignedLines: boolean
  regions: CanvasRiskRegion[]
}
```

### 6.1 Low-Risk Operations

These should not be perturbed by default:

- Pure-color `fillRect`.
- `clearRect`.
- Integer-coordinate horizontal or vertical lines.
- Simple rectangles without gradient, transform, shadow, filter, or composite mode.
- Large UI-like chart fills that do not read back pixels.

### 6.2 High-Risk Operations

These should increase risk and may be perturbed:

- `fillText`, `strokeText`, `measureText`.
- `arc`, `arcTo`, `ellipse`, `bezierCurveTo`, `quadraticCurveTo`.
- Non-axis-aligned lines.
- Fractional coordinates.
- Gradient or pattern fill/stroke.
- `drawImage`, especially from image, video, canvas, or SVG sources.
- Non-identity transform.
- Shadow, filter, alpha blending, or non-default composite mode.
- Export or readback APIs: `getImageData`, `toDataURL`, `toBlob`, `convertToBlob`.

### 6.3 Perturbation Layers

Layer 1: parameter perturbation.

- Slightly shift curve control points.
- Slightly shift text x/y coordinates.
- Slightly adjust gradient stop offsets.
- Slightly adjust non-axis-aligned line endpoints.

Layer 2: text perturbation.

- Apply stable tiny x/y offsets to `fillText` and `strokeText`.
- Apply matching stable adjustments to `measureText`.
- Do not modify text content.

Layer 3: export-time pixel perturbation.

- Only apply when the canvas risk score exceeds threshold.
- Prefer local regions around text, curves, gradients, and image draw areas.
- Avoid perturbing pure solid fills and axis-aligned UI shapes.

### 6.4 Risk Scoring

Initial scoring model:

| Signal | Score |
| --- | ---: |
| `fillText` / `strokeText` | 40 |
| `measureText` | 20 |
| Gradient fill/stroke | 25 |
| Curve path | 25 |
| `drawImage` | 20 |
| Non-axis-aligned line | 10 |
| Shadow/filter/composite | 15 |
| Transform | 10 |
| Pure `fillRect` | 0 |
| Axis-aligned integer line | 0 |

Export policy:

- `< 20`: no perturbation.
- `20-49`: parameter-level perturbation only.
- `50-99`: local light pixel perturbation.
- `>= 100`: stronger local perturbation for text, curve, and gradient regions.

## 7. Audio Design

Audio protection should focus on offline fingerprint chains, not real playback.

High-risk signals:

- `OfflineAudioContext`.
- `startRendering`.
- `OscillatorNode`.
- `DynamicsCompressorNode`.
- `AudioBuffer.getChannelData`.
- `copyFromChannel`.
- `AnalyserNode.getFloatFrequencyData`.
- `AnalyserNode.getByteFrequencyData`.
- Short-lived graph that renders and reads data without user-facing playback.

Low-risk signals:

- `HTMLAudioElement` media playback.
- Long-lived interactive `AudioContext`.
- User gesture initiated playback.
- No buffer or spectrum readback.

Perturbation:

- Do not perturb all audio globally.
- Perturb `DynamicsCompressorNode.reduction` lightly for medium risk.
- Perturb rendered buffer data only for high-risk offline-render profiles.
- Never perturb all-zero or silent buffers.
- Avoid repeated perturbation of the same returned typed array.

Initial thresholds:

- `< 40`: no perturbation.
- `40-79`: only light compressor reduction perturbation.
- `>= 80`: stable sparse buffer perturbation around `1e-8` to `1e-7`.

## 8. WebGL Design

WebGL protection combines stable metadata spoofing with risk-based readback noise.

High-risk signals:

- `getExtension("WEBGL_debug_renderer_info")`.
- `getParameter(UNMASKED_VENDOR_WEBGL)`.
- `getParameter(UNMASKED_RENDERER_WEBGL)`.
- `readPixels`.
- Shader compile plus small canvas plus pixel readback.
- Bulk reads of extensions, precision formats, or limits.

Low-risk signals:

- Visible rendering without readback.
- Games, maps, 3D model viewers, and long-running render loops.

Perturbation:

- Bucketize or configure GPU metadata.
- Hide or normalize selected high-entropy extensions only when safe.
- Perturb `readPixels` only when risk is high.
- Do not degrade visible render output unless readback occurs.

## 9. WebGPU Design

WebGPU protection must avoid breaking modern 3D and compute workloads.

High-risk signals:

- `navigator.gpu.requestAdapter`.
- `adapter.requestDevice`.
- Reads of `adapter.limits`, `adapter.features`, `adapter.info`, or `requestAdapterInfo`.
- Compute pipeline creation.
- `copyTextureToBuffer`.
- `GPUBuffer.mapAsync`.
- `GPUBuffer.getMappedRange`.
- Short-lived GPU workload followed by readback.

Low-risk signals:

- Visible rendering with no readback.
- Long-lived render loop.
- No adapter metadata enumeration beyond required setup.

Perturbation:

- Bucketize capability values rather than randomly changing them.
- Never report limits lower than values already used by the page.
- Hide high-entropy features only if the page has not requested them.
- Perturb mapped readback buffers only for high-risk profiles.

Example bucketization:

- `maxTextureDimension2D`: 4096, 8192, 16384.
- `maxComputeWorkgroupSizeX`: 128, 256.
- `maxComputeInvocationsPerWorkgroup`: 128, 256, 512.
- `maxBufferSize`: common power-of-two or browser-common buckets.

## 10. Fonts Design

Fonts protection should detect bulk probing patterns.

High-risk signals:

- Large batches of `measureText`.
- Hidden DOM font measurement using `offsetWidth`, `offsetHeight`, or `getBoundingClientRect`.
- `FontFace` with `local(...)`.
- Common fingerprint test strings, emoji strings, CJK samples, and pangrams.
- Measurement inside hidden iframe.

Perturbation:

- Do not perturb normal page layout by default.
- Apply stable small width/height changes only to high-risk measurement patterns.
- For `FontFace("x", "local(...)")`, optionally hide a small stable subset of local fonts.
- Keep Canvas text drawing and `measureText` behavior consistent.

## 11. Stable Value Modules

Stable value modules must prioritize internal consistency.

Rules:

- JavaScript `navigator.userAgent` must match the network `User-Agent` header.
- `navigator.userAgentData` must match `Sec-CH-UA-*` headers.
- `navigator.languages` must match `Accept-Language`.
- `Date`, `Intl.DateTimeFormat`, and timezone offset must agree.
- Screen and viewport values must remain plausible.

These modules should not dynamically change values based on risk score. They should be stable for the chosen seed/configuration mode.

## 12. Native Function Stealth Core

The extension must include a first-class native-function stealth layer. This layer protects all hooks from common checks that try to determine whether functions are native or patched.

### 12.1 Threat Model

Pages may check:

- `Function.prototype.toString.call(fn)`.
- `fn.toString()`.
- Own properties on functions.
- Property descriptors.
- Function `name`, `length`, and prototype shape.
- `Object.getOwnPropertyNames`.
- `Object.getOwnPropertyDescriptors`.
- `Object.getOwnPropertySymbols`.
- `Reflect.ownKeys`.
- `Object.getPrototypeOf`.
- `Object.setPrototypeOf` and `Reflect.setPrototypeOf`.
- `instanceof`, constructor identity, and brand checks.
- Error stack traces triggered by invalid calls.
- Proxy artifacts and revoked proxy behavior.
- Cross-realm differences using iframes.

### 12.2 Design Principles

- Preserve original function identity where possible by replacing descriptors carefully.
- When proxying is required, map proxy functions back to their original native source.
- Return native-looking `toString` output for hooked functions.
- Hide internal symbols and metadata from reflection APIs.
- Preserve `name`, `length`, descriptors, enumerability, configurability, and writability.
- Match native TypeError behavior and stack shape as closely as practical.
- Apply the same stealth rules in windows, iframes, workers, and supported same-origin realms.

### 12.3 Core Data Structures

```ts
type NativeStealthRecord = {
  proxy: Function
  raw: Function
  source: string
  name: string
  length: number
}

type NativeStealthState = {
  functionMap: WeakMap<Function, NativeStealthRecord>
  rawMap: WeakMap<Function, Function>
  hiddenKeys: WeakMap<object, Set<PropertyKey>>
  internalSymbols: Set<symbol>
}
```

### 12.4 Required Hooks

The stealth layer should hook:

- `Function.prototype.toString`.
- `Object.getOwnPropertyName`.
- `Object.getOwnPropertyNames`.
- `Object.getOwnPropertyDescriptor`.
- `Object.getOwnPropertyDescriptors`.
- `Object.getOwnPropertySymbols`.
- `Reflect.ownKeys`.
- `Object.setPrototypeOf`.
- `Reflect.setPrototypeOf`.
- `Proxy` constructor tracking for third-party proxies.

### 12.5 Native Source Generation

For a wrapped native function, `toString` should return the original native source captured before modification.

For synthetic functions that must appear native, generate browser-like output:

```txt
function getImageData() { [native code] }
function toDataURL() { [native code] }
```

The implementation must preserve exact formatting conventions for the current browser family when possible.

### 12.6 Anti-Detection Records

When the page performs suspicious native checks, record signals:

- `native-check.toString`
- `native-check.ownKeys`
- `native-check.descriptor`
- `native-check.prototype`
- `native-check.stack`
- `native-check.crossRealm`

These signals should appear in the popup activity record and may increase the page risk score.

## 13. Configuration Presets

Recommended presets:

### Balanced

- Canvas 2D: domain semantic noise.
- Audio: high-risk offline chain only.
- WebGL: metadata bucketization and high-risk readback noise.
- WebGPU: capability bucketization only, readback noise off by default.
- Fonts: bulk probing only.
- Stable values: default unless user configures.

### Privacy

- Canvas 2D: page semantic noise.
- Audio: high-risk offline chain.
- WebGL: metadata bucketization and readback noise.
- WebGPU: capability bucketization and high-risk readback noise.
- Fonts: bulk probing plus local-font hiding.
- WebRTC: disabled.

### Compatibility

- Canvas 2D: text and gradient only.
- Audio: compressor only.
- WebGL: metadata only.
- WebGPU: metadata only.
- Fonts: off.
- WebRTC: default.

### Research

- All records enabled.
- Debug profile visible.
- Export raw risk signals.
- Fine-grained thresholds adjustable.

## 14. Validation Targets

Test against:

- BrowserLeaks.
- CreepJS.
- FingerprintJS demo.
- WebBrowserTools.
- Browserscan.
- Custom Canvas 2D test suite.
- Custom Audio offline-render test suite.
- Custom WebGPU readback test suite.
- Custom native-function detection suite.

Success criteria:

- Fingerprint output changes when protection is enabled.
- Output remains stable inside the selected seed mode.
- Pure-color and axis-aligned Canvas tests remain unchanged.
- Common visible graphics demos still render correctly.
- Native-function checks do not trivially reveal hooks.
- Whitelisted sites receive original API behavior.

