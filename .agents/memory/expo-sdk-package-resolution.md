---
name: Expo SDK package resolution
description: Expo package versions may differ from the first version suggested by the package registry in this workspace.
---

When adding Expo modules, verify the version actually available through the workspace package firewall and keep the app's Expo SDK compatibility in mind.

**Why:** The registry can omit the expected SDK-matched alias while exposing a newer SDK-tagged release, so a direct install may fail even when the package is valid.

**How to apply:** Try the SDK-matched version first; if the registry rejects it, inspect available releases and choose the newest compatible version that resolves before continuing.