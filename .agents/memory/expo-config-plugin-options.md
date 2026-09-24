---
name: Expo config plugin options
description: Avoid duplicate config plugins after Expo CLI package installation.
---

After installing an Expo config plugin, check whether Expo CLI added a bare plugin entry to `app.json`. Merge required options into that entry and keep only one configured entry.

**Why:** The installer can add a plugin name automatically; adding a separate options entry can leave duplicate plugin registrations in the resolved public config.

**How to apply:** Inspect `app.json` after `expo install`, consolidate duplicate plugin entries, and run `expo config --type public` to confirm the single entry contains the expected options.