---
name: Android wallpaper chooser messaging
description: Constraint for communicating success while the Android/Oppo live wallpaper chooser is still visible.
---

The Android live wallpaper chooser is owned by the system and cannot render a React Native modal from the app. Confirmation that the wallpaper was applied must be emitted by the native wallpaper service after it detects that its own `WallpaperInfo` is active; a native Toast is appropriate for the short confirmation.

**Why:** The app can be backgrounded while the system screen with “Aplicar a” remains visible, so an in-app success modal appears only after returning to the app and is shown on the wrong screen.

**How to apply:** Mark an application as pending before opening `ACTION_CHANGE_LIVE_WALLPAPER`, clear it only after the service verifies activation, and avoid showing the confirmation during the chooser’s initial preview.