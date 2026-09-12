---
name: Expo native splash sync
description: Native splash resources can remain stale after changing the Expo config.
---

When an Expo project contains prebuilt Android and iOS folders, changing the splash path in `app.json` is not enough for an already generated native build. The platform splash resources may still contain the previous image.

**Why:** The installed native app uses splash assets bundled during its native build, not the current Metro preview or the current `app.json` file at runtime.

**How to apply:** When replacing a splash image, verify the resolved Expo config and the generated Android/iOS splash resources, then rebuild or reinstall the native app before judging the result on a device.