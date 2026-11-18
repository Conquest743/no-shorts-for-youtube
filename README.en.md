# No Shorts for YouTube

![No Shorts for YouTube icon](icons/icon48.png)

This Chrome extension hides Shorts from the YouTube interface. When you open a link to a Short, it plays in the regular YouTube player.

[Инструкция на русском](README.md)

**[Download for Chrome (ZIP)](https://github.com/Conquest743/no-shorts-for-youtube/releases/latest/download/no-shorts-for-youtube.zip)**

## Install in Chrome

1. Open **Releases** on the repository page. In the latest release, expand **Assets** and download **no-shorts-for-youtube.zip**.
2. Extract the ZIP to a folder you can keep, such as Documents. Find the folder containing `manifest.json`.
3. Open `chrome://extensions/` in desktop Chrome and turn on **Developer mode**.
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Refresh your YouTube tabs. Open a Shorts link to check that the address changes from `/shorts/…` to `/watch?v=…`.

To update, extract the new ZIP over the files in the same folder, click the circular reload arrow on the extension card, and refresh your YouTube tabs. To turn it off, use the switch on the same card and refresh YouTube.

The extension runs on `www.youtube.com` and `m.youtube.com` in desktop Chrome. The toolbar popup shows a counter stored in your Chrome profile. The extension does not send the counter to a server.

If a Shorts shelf still appears or regular videos disappear, open **Issues → New issue** and include the page, your Chrome version, and the extension version.
