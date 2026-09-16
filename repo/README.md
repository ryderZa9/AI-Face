# Cipher Face

A matrix-glyph AI face rendered as a three.js point cloud. Two faces — a
relief head and a stylized mask — cross-fade into each other, and the mouth
lip-syncs to live microphone input, to any audio you play, or to the browser's
speech synthesis.

All geometry is generated procedurally at load time (bas-relief depth map +
facial contours projected onto an ellipsoid skull). There are no model files,
textures, or image assets.

## Files

- `index.html` — full-screen demo with controls (Head/Mask, Speak, Mic, Monitor, Audio file)
- `cipher-face.js` — the reusable module

## Use

```html
<script type="importmap">
{ "imports": {
    "three": "https://unpkg.com/three@0.184.0/build/three.module.js",
    "three/addons/controls/OrbitControls.js":
      "https://unpkg.com/three@0.184.0/examples/jsm/controls/OrbitControls.js"
} }
</script>
<div id="face" style="position:fixed;inset:0"></div>
<script type="module">
  import { createCipherFace } from './cipher-face.js';
  const face = createCipherFace({ container: document.getElementById('face') });
</script>
```

See `index.html` for the full pinned import map (with integrity hashes).

## API

`createCipherFace(options)` returns an object.

### Options

| option | default | meaning |
| --- | --- | --- |
| `container` | `document.body` | element the canvas is appended to; sized to it |
| `face` | `'head'` | which face is shown first — `'head'` or `'mask'` |
| `accent` | `'#8b5cfe'` | accent color on facial features |
| `background` | `'#0a0a0c'` | clear color |
| `transparent` | `false` | transparent canvas instead of a background |
| `distance` | `4.6` | initial camera distance |
| `orbit` | `true` | drag to orbit, scroll to zoom |
| `parallax` | `true` | head turns slightly toward the pointer |
| `audioContext` | — | reuse an existing `AudioContext` |
| `onState`, `onLevel` | — | callbacks: state string, mouth level 0–1 |

### Methods

| call | what it does |
| --- | --- |
| `setFace('head' \| 'mask')` | cross-fades between the two faces |
| `speak(text, opts)` | browser voice, audible, lip-synced from a speech envelope. `opts`: `rate`, `pitch`, `volume`, `voice`. Returns a promise |
| `useAudioElement(el)` | plays an `<audio>` element through the speakers and lip-syncs to its amplitude |
| `useAudioSource(node, ctx)` | lip-syncs to any WebAudio node (streaming TTS) |
| `useMic()` | lip-syncs to the live microphone. Returns a promise (permission) |
| `setMonitor(bool)` | routes the mic to the speakers — headphones only, it will feed back |
| `stop()` | tears down mic/audio/speech, returns to idle breathing |
| `resize()` | manual re-layout (a ResizeObserver handles the usual cases) |
| `dispose()` | stops the loop, releases GL resources, removes the canvas |

### Properties

`face`, `mode` (`idle` / `listening` / `speaking` / `tts`), `level`,
`audioContext`, `canvas`.

## Lip-sync notes

Microphone and audio-element input are analysed for real amplitude: a low band
(90–520 Hz) drives jaw opening, a high band (1.8–5.2 kHz) drives mouth width.

`speak()` uses `speechSynthesis`, which cannot be routed into an analyser, so
during it the mouth runs on a synthetic envelope gated by word-boundary events.
For exact lip-sync with a real TTS service, feed its audio in through
`useAudioElement` or `useAudioSource`.

## Serving

ES modules need HTTP — `file://` will not load `cipher-face.js`. Any static
server works, GitHub Pages included.
