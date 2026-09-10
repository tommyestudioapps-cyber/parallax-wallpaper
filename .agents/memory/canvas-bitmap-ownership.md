---
name: Canvas bitmap ownership
description: The Canvas renderer must retain decoded bitmap references in its lifecycle-owned collection so cleanup can release them.
---

Decoded bitmaps used by Canvas layers must also be retained by the renderer's lifecycle-owned collection, not only by composition objects.

**Why:** Composition replacement, memory pressure, and renderer release all converge on one cleanup path; without a renderer-owned reference, the cleanup loop cannot recycle decoded memory.

**How to apply:** When changing Canvas composition loading, keep the decoded bitmap and the release collection synchronized, and keep static lifecycle checks tied to the actual ownership handoff.