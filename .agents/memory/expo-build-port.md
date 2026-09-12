---
name: Expo build port
description: The custom static Expo build's Metro startup assumes port 8081 is available.
---

The parallax wallpaper static build script starts Metro without selecting a port and checks `localhost:8081`. Running it while another workflow owns that port can trigger Expo's non-interactive "use another port?" prompt and end in a timeout.

**Why:** The project has a separate component preview workflow that can occupy port 8081, while the custom build cannot answer the port prompt in CI-style execution.

**How to apply:** Before using the custom static build, ensure port 8081 is free; for a code-only bundle check in a busy workspace, use a direct non-interactive Expo export instead.