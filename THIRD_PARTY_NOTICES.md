# Third-party notices

## Firmware baseline

The firmware overlay integrates with Times-Z/GeekMagic-Open-Firmware:
https://github.com/Times-Z/GeekMagic-Open-Firmware

Pinned upstream commit: a0c2ddcef4e76fa6eb040f6f544124763a2d85f5.
Upstream is distributed under GNU GPL version 3. Preserve its copyright,
license notices and source obligations when distributing combined firmware.
The full upstream checkout and compiled images are not included here.

## Runtime and build dependencies

Node.js, Swift/macOS SDKs, PlatformIO, ESP8266 Arduino core, ArduinoJson,
Arduino_GFX, AnimatedGIF and optional Stats are external dependencies.
They retain their respective licenses and are not relicensed by this repository.
The source release does not distribute their binaries. If releasing an app or
firmware binary, include the applicable dependency notices and corresponding
source materials before distribution.

## Artwork and fonts

The early local prototype referenced the following materials:

- DeepSeek girl / whale-girl pixel animations (22 GIFs), obtained from the
  [dsh-TUI whale-girl emoji page](https://dshtui.com/pets/whale-girl-emoji/).
  The prototype displayed the GIFs on Mac and converted their 69×66 logical
  pixel grid to WSP1 sprites for the clock. This identifies the source page;
  the original artwork and animation authors and redistribution permissions
  have not been established. No license is inferred from download availability.
- A WCF1 bitmap font generated from macOS PingFang SC Regular
  (`PingFangSC-Regular`). See Apple's
  [system font listing](https://developer.apple.com/fonts/system-fonts/) and
  [software license agreements](https://www.apple.com/legal/sla/). Permission
  to redistribute this generated bitmap with firmware has not been established;
  consult the terms accompanying the system and font actually used.

These references acknowledge provenance; they do not grant an asset license,
relicense the materials under GPL, or imply endorsement of Deepet. Further
details and asset preparation instructions are in [docs/ASSETS.md](docs/ASSETS.md).

No third-party character GIF, derivative WSP1 sprite, compiled system-font
bitmap, reference photo or private-device screenshot is distributed here.
The geometric SVG placeholder in assets/public is original project artwork
under GPL-3.0-or-later. Supply only assets you have permission to redistribute.
