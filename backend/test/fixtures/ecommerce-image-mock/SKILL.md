---
name: ecommerce-image-mock
description: Create or edit ecommerce product image test results through SEP's explicitly enabled mock media tools, with human approval and recoverable local delivery. Use for mock-only product image workflow acceptance, not real production images.
---

# Ecommerce Image Mock

Workflow marker: `SEP_ECOMMERCE_IMAGE_MOCK_V1`.

This approved Skill describes a mock-only workflow. It grants no tool permissions.
Do not call an image provider, relay CLI, shell script, billing API, or external URL.
Do not claim that the static mock PNG is a usable product image or that money was charged.

## Prepare

1. Read this approved installed entry, then call `media_get_capabilities`.
2. Continue only when the host explicitly exposes executable mock profiles.
   Otherwise explain that image execution is unavailable and stop.
3. Use `mock-sync` for a synchronous reference edit, `mock-async` for an
   asynchronous generation. Select only operations and parameter values reported
   by the selected profile. Never infer model support from its name.
4. Reference images must already be imported into the current task. Pass only
   their returned `localAssetId` values. Never pass a local path or remote URL.
   For an edit without an imported reference, ask the user to import one.

## Execute

Call `media_generate_image` once for each explicitly requested test result.
The host handles quotation, reference-upload consent, and generation consent.
Wait for the user; never approve your own tool, bypass consent, or invent a quote.
If consent is denied or authorization fails, stop without retrying generation.

Keep the returned `jobId`. Query it with `media_get_job` when tracking is needed.
On a disconnect, uncertain submission, or restart, recover that original job;
do not create another generation to obtain a missing response.
Use `media_cancel_job` only when the user asks to cancel and the host allows it.

## Deliver

Report generation status and local save status separately. A succeeded job is
not proof of a saved file. Only report local delivery after the host confirms
`saveStatus: SAVED`; preview/export are client actions.
Report `MOCK_NOT_CHARGED` truthfully. If delivery is pending or authorization
needs restoration, retain the original receipt and explain the actual state.
