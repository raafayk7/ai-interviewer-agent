# Phase 9.5 — ElevenLabs Conversational AI Contract Spike Findings

> Date: 2026-05-21 · SDK: `@elevenlabs/elevenlabs-js` v2.49.1 (static type inspection) · Live API: partially probed (key is TTS-scoped only)
> Purpose: de-risk the corrected ADR-030/031 design before implementation. Feeds `backend-plan-generator`.

## HARD BLOCKER (user action required)

The `apps/backend/.env` `ELEVENLABS_API_KEY` is **TTS-scoped only**. Live convai probes returned HTTP 401 `missing_permissions` for `convai_read`, `convai_write`, `voices_read`, `user_read`. `getSignedUrl` and agent create/get/delete all require `convai_write`.

**Until a `convai_write`-scoped ElevenLabs API key is provisioned:** no agent creation, no signed URLs, no live initiation-webhook test, and no runtime for the new path. Planning is unaffected. Network egress itself works (real 401s came back without sandbox override).

**Update:** The API Key has been updated with the following settings

- *TTS:* Access
- *ElevenAgents:* Write
- *Voices:* Read
- *Everything else (STS,STT,Sound Effects, Audio Isolation, Music Generation, Dubbing, Projects, Audio Native, Voice Generation, Forced Alignment):* No Access

## CONFIRMED from SDK types (`apps/backend/node_modules/@elevenlabs/elevenlabs-js/api/types/`)

- **create-agent**: `client.conversationalAi.agents.create(body)`; body `BodyCreateAgentV1ConvaiAgentsCreatePost = { conversationConfig (required); platformSettings?; workflow?; name?; tags?; enableVersioning? }`.
  - System prompt + LLM + tools at `conversationConfig.agent.prompt` (`prompt?`, `llm?`, `temperature?`, `maxTokens?`, `toolIds?: string[]`, `tools?` DEPRECATED, `builtInTools?`, `knowledgeBase?`).
  - **Voice** at `conversationConfig.tts.voiceId` (NOT on the agent).
- **getSignedUrl**: request `{ agentId (required); includeConversationId?; branchId?; environment? }` → `{ signedUrl: string }`. `includeConversationId: true` ⇒ signature is **single-use**.
- **Initiation-webhook RESPONSE (we return)**: `ConversationInitiationClientDataRequestOutput = { conversationConfigOverride?; dynamicVariables?; customLlmExtraBody?; userId?; sourceInfo?; branchId?; environment?; startingWorkflowNodeId? }`. System-prompt override path: `conversationConfigOverride.agent.prompt.prompt`; agent override also exposes `firstMessage?`, `language?`.
- **Initiation-webhook REQUEST (ElevenLabs sends us)**: `ConversationInitiationClientDataRequestInput`, same shape, **has a `dynamicVariables` field** (the type-level slot where the browser-supplied correlation token would surface; live forwarding NOT proven — surprise #3).
- **Tool webhooks**: `WebhookToolConfigInput.apiSchema = { url; method?; requestHeaders?; requestBodySchema?; contentType?; authConnection? }`. URL/headers per-tool; no built-in HMAC field (use headers or `authConnection`).
- **Post-call/transcript webhook**: **workspace-level**, referenced by `ConvAiWebhooks.postCallWebhookId` + `events?: ("transcript"|"audio"|"call_initiation_failure")[]`. HMAC settings via `WebhookHmacSettings = { authType:"hmac"; name; webhookUrl; requestHeaders? }`.
- **LLM enum** includes `gpt-4o`, `gpt-4.1`, `gpt-5.x`, `gemini-*`, `claude-sonnet-4-6`, `custom-llm`.

## 7 CONTRACT SURPRISES (reshape the PLAN, not the ADR decisions)

1. `**enableConversationInitiationClientDataFromWebhook` lives in `platformSettings.overrides`** (`AgentPlatformSettingsRequestModel.overrides: ConversationInitiationClientDataConfigInput`), NOT in `conversationConfig`.
2. **Override is gated by a separate boolean allow-list**: `platformSettings.overrides.conversationConfigOverride` (`ConversationConfigClientOverrideConfigInput`) is a boolean allow-list of overridable fields. Without `agent.prompt.prompt = true` (and `agent.firstMessage = true`) there, the webhook's prompt override is **silently dropped**. CRITICAL correctness gotcha.
3. **Correlation-token surfacing: type-confirmed, live behavior NOT proven.** `ConversationInitiationClientDataRequestInput.dynamicVariables` exists, but SDK types can't prove browser-passed dynamic variables are forwarded into the initiation webhook request (vs only used for prompt interpolation). Must verify live.
4. **Inline `tools` are deprecated** — create the 4 tools standalone and reference via `toolIds`.
5. `**end_interview` is best modeled as the built-in `end_call` system tool** (`SystemToolConfigInput`, type `"system"`), not a custom webhook tool — a custom tool won't cleanly terminate the LiveKit session.
6. **Post-call/transcript webhook is workspace-scoped, not per-agent** — one shared HMAC endpoint; correlate by `conversation_id`; persist the HMAC secret from the workspace-webhook create response (exact field name unverified live).
7. `**includeConversationId: true` ⇒ single-use signed URL** — mint a fresh signed URL per connect attempt.

## NOT VALIDATED HEADLESS (needs convai_write key + public HTTPS ingress + browser/mic)

(a) the initiation webhook actually fires at session start; (b) the prompt override is honored live; (c) the browser-passed correlation token appears in the webhook body (resolves surprise #3).

### Local recipe to confirm the three live behaviors

```bash
# 1. Public echo webhook returning a hardcoded override:
cat > /tmp/init-webhook.mjs <<'EOF'
import http from "node:http";
http.createServer((req,res)=>{let b="";req.on("data",c=>b+=c);req.on("end",()=>{
  console.log("INIT WEBHOOK FIRED\nheaders:",req.headers,"\nbody:",b); // look for HMAC header + dynamic_variables + token
  res.setHeader("content-type","application/json");
  res.end(JSON.stringify({conversation_config_override:{agent:{
    first_message:"OVERRIDE-APPLIED: webhook works.",
    prompt:{prompt:"You must say PINEAPPLE in your first sentence."}}},
    dynamic_variables:{spike_marker:"ok"}}));});
}).listen(8787,()=>console.log("listening :8787"));
EOF
node /tmp/init-webhook.mjs &
cloudflared tunnel --url http://localhost:8787      # -> $WEBHOOK_URL
# 2. Create throwaway agent "sift-spike-DELETEME": flag on, allow-list agent.prompt.prompt=true
#    + agent.first_message=true, tts.voice_id, 4 tools, initiation webhook URL = $WEBHOOK_URL.
# 3. getSignedUrl({ agentId, includeConversationId: true })
# 4. Browser connect (mic) with @elevenlabs/client:
#      const c = await Conversation.startSession({ signedUrl, dynamicVariables: { correlation_token: "<token>" } });
#    Watch step-1 console: is correlation_token in the body? Does the agent say OVERRIDE-APPLIED/PINEAPPLE?
# 5. client.conversationalAi.agents.delete(agentId)  -> confirm void/200.
```

Pass/fail: (a) webhook log prints → fires; (b) agent speaks override text → honored; (c) `correlation_token` in body → token surfacing works.

## RECOMMENDED PLAN ADJUSTMENTS

- Put `enableConversationInitiationClientDataFromWebhook: true` in `platformSettings.overrides`.
- Add the boolean override allow-list at `platformSettings.overrides.conversationConfigOverride` (≥ `agent.prompt.prompt`, `agent.firstMessage`).
- Set voice at `conversationConfig.tts.voiceId = "EXAVITQu4vr4xnSDxMaL"`.
- Create the 4 tools standalone, reference via `toolIds`; model `end_interview` as built-in `end_call` (verify name live).
- Treat post-call/transcript as one workspace-level HMAC webhook (`WebhookHmacSettings`) linked via `ConvAiWebhooks.postCallWebhookId`, `events: ["transcript","call_initiation_failure"]`; correlate by `conversation_id`; persist the HMAC secret from the create response.
- Mint a fresh signed URL per connect (single-use).
- **Provision a `convai_write`-scoped API key** — current `.env` key is TTS-only (hard blocker).
- Add a startup/integration assertion that the persisted agent still has the flag + allow-list (drift guard).
- Run the live recipe above to confirm the three live behaviors before building lifecycle on top.

## Spike scope discipline

Read SDK `.d.ts` only; no project source/ADRs modified by the spike. No cloud resources created (creation needs `convai_write`, which the key lacks) — nothing to clean up server-side.