# Video Spoiler Hider

A small Chrome/Edge/Firefox (MV3) extension that hides the **duration**, **seek
bar progress**, **hover timestamp**, and **chapter markers** on Twitch VOD pages
(`twitch.tv/videos/*`) and YouTube watch pages (`youtube.com/watch?v=...`) so you
can watch without seeing how much time is left.

Playback controls (play/pause, volume, fullscreen, quality) still work normally.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
   In this checkout, that is the inner `twitch-vod-spoiler-hider/` directory.
4. Open any `twitch.tv/videos/<id>` or `youtube.com/watch?v=...` page — the
   duration and seek bar progress will be hidden.

## Toggle

Click the extension icon to enable/disable the hider. Setting is synced via
`chrome.storage.sync`.

## How it works

- `content.js` adds the `tvsh-active` class to `<html>` whenever the URL matches
  a supported Twitch or YouTube video route, and removes it elsewhere.
- `content.js` also adds a platform class (`tvsh-platform-twitch` or
  `tvsh-platform-youtube`) so CSS rules stay scoped to the current site.
- `content.css` uses those classes to hide the relevant player elements while
  keeping current playback time and hover thumbnails visible.
- A small popup writes the on/off state to `chrome.storage.sync`.

If Twitch or YouTube changes their player markup and something leaks through,
update the selectors in `content.css`.
