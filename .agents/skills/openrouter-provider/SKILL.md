---
name: openrouter-provider
description: "Integrates OpenRouter text/vision/model metadata/tool routing securely, validates capabilities, enforces budgets, handles streaming, abort, errors and web-search compatibility."
---

# OpenRouter Provider

## Preconditions
Review official current docs and compare actual selected Chat Completions vs Responses API. No hardcoded provider claims or random model names.

## Procedure
1. Main-only API key from OS-protected store; build typed HTTP adapter. Do NOT pass key via preload/renderer.
2. List available model metadata, check vision, context, tool and audio support for chosen **specific** endpoint. Support = documented AND ideally small verified test.
3. Implement text first, then one real vision image. Keep request builder small and testable with fake fetch.
4. Support stream/abort, timeout, 401, 402/credits, 429, 5xx, malformed responses and missing usage. Never retry infinitely.
5. Web search: follow current official `openrouter:web_search` tool route where applicable; don't resurrect deprecated plugin syntax; return citations and distinguish unsourced response.
6. Route classifier/STT separately when supported; local fallback for STT. Do not assume generic text model understands audio.
7. Usage and cost: estimate before call, update actual usage if returned, cap per session; manual approval on costly uncertain call.
8. No unapproved provider/model fallback; never print API key or store screenshots in logs.

## Tests
Fake HTTP tests for invalid model vision capability, budget cap, 429 retry policy, abort, malformed tool args, missing citation, absence of actual usage.

## Important references
https://openrouter.ai/docs/api_reference/overview ; https://openrouter.ai/docs/guides/overview/multimodal/image-understanding ; https://openrouter.ai/docs/guides/features/plugins/web-search
