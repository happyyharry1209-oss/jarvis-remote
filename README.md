# JARVIS Remote

Responsive JARVIS web client for iPhone, iPad and desktop Safari. The public
site is static; commands are sent to the JARVIS backend on your Windows computer
through the private Tailscale network.

## First connection

1. Install and sign in to Tailscale on the Windows computer, iPhone and iPad.
2. Open JARVIS on the computer and click **Remote Control**.
3. Scan the QR code with the device camera.
4. In Safari, tap **Share** and then **Add to Home Screen**.

The pairing key is valid for one connection and expires after ten minutes.

## Use from home or away

Keep the computer awake, JARVIS running and Tailscale connected. The same
`https://happyyharry.github.io/jarvis-remote/` address works over home Wi-Fi and
cellular data.

If JARVIS is stopped, the site still opens from GitHub Pages and displays an
offline state.

## Security

This repository contains the static frontend only. Never commit API keys,
certificates, JARVIS configuration, memories, uploads or pairing tokens.

The backend is exposed only through Tailscale Serve at
`https://laptop-sjbbf3bk.tail84c23f.ts.net`.
