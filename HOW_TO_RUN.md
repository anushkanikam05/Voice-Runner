# Voice Runner — Noise Chaos

A browser-based voice-controlled runner game built with **vanilla HTML, CSS, and JavaScript**.

## 📁 Project Structure

```
voice-runner/
├── index.html
├── style.css
├── script.js
└── assets/
    └── bg.mp3        ← place your background music here
```

## ▶️ Run in VS Code with Live Server

1. Open the `voice-runner` folder in **VS Code**.
2. Install the **"Live Server"** extension by *Ritwick Dey* (from the Extensions panel).
3. Drop your background music file into the `assets/` folder and rename it to **`bg.mp3`**.
   *(The game still runs without it — only music will be silent.)*
4. Right-click `index.html` → **"Open with Live Server"**.
   The game opens at `http://127.0.0.1:5500/index.html`.
5. Click **START GAME** and **allow microphone access** when prompted.

> 💡 The microphone API requires `http://localhost`, `127.0.0.1`, or `https://`.
> Opening the file directly via `file://` will block mic access.

## 🎮 Controls

### Voice (primary)
| Input | Action |
|---|---|
| Loud voice | Jump |
| Very loud voice | Speed boost |
| Soft / low voice | Slow motion |
| Say "jump" / "up" | Jump |
| Say "go" / "fast" / "boost" | Speed boost |
| Say "stop" / "slow" / "down" | Slow motion |

### Desktop fallback
- **Space** → Jump
- **Shift** → Speed boost
- **S** → Slow motion

### Mobile fallback
- **Tap** → Jump
- **Hold** → Slow motion
- **Swipe right** → Speed boost

## ⚡ Energy / Stamina
- Speaking drains the energy bar.
- Silence regenerates it.
- Low energy reduces voice control responsiveness and jump height.

## 🌪️ Noise Chaos
Continuous loud or sudden ambient noise randomly triggers:
- Screen shake
- Hue/glitch color shifts
- Inverted colors
- Temporary speed changes

## 🌐 Browser support
- ✅ Chrome / Edge (best — supports Web Speech API)
- ✅ Firefox (mic + intensity work; speech keywords may not)
- ✅ Safari iOS / Android Chrome (touch fallback works; mic prompt required)
