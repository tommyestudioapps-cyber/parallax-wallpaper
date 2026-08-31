---
name: Wallpaper rendering thread
description: Native live-wallpaper rendering must keep service callbacks responsive while images and canvas frames are handled.
---

Live-wallpaper callbacks must remain responsive: image decoding and potentially blocking canvas operations should not run synchronously on the callback thread, and frame requests should be serialized or coalesced.

**Why:** A captured Android log showed an ANR in the wallpaper service after a touch waited more than five seconds; the service's synchronous bitmap loading and canvas lock were the likely blocking path.

**How to apply:** When changing the parallax service, keep loading off the service callback thread, avoid repeated frame work from sensor events, and retain native logs around surface creation, bitmap loading, drawing, and failures.