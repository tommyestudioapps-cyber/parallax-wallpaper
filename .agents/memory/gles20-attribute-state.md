---
name: GLES20 attribute state
description: Android GLES20 exposes attribute metadata but no vertex-pointer getter.
---

Android's GLES20 Java API has no `glGetVertexAttribPointerv`; for renderer-owned attributes, preserve the canonical VBO layout and restore the queryable enablement and buffer state instead of relying on an unavailable pointer readback.

**Why:** Attempting to query the pointer prevents the Android Java source from compiling, while this renderer controls the attribute locations and their fixed quad offsets.

**How to apply:** When isolating diagnostics on the renderer's EGL context, use the renderer's known attribute offsets and restore the enabled flags and buffer binding around temporary draws.