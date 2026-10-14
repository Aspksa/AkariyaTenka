# Cloud.ru Foundation Models

Akariya can use Cloud.ru Foundation Models through its OpenAI-compatible Chat Completions API. The AI key stays on the **server**.

## Windows setup

From a trusted PowerShell session in the project root:

```powershell
$env:AKARIYA_CLOUDRU_API_KEY = Read-Host "Cloud.ru Foundation Models API key"
$env:AKARIYA_CLOUDRU_MODEL = "ai-sage/GigaChat3-10B-A1.8B"
.\AKARIYA.bat
```

The key is set only in that PowerShell process. Do not commit credentials or enter them in the browser.

Configuration:
- `AKARIYA_CLOUDRU_API_KEY`: Cloud.ru **Foundation Models API key** (required).
- `AKARIYA_CLOUDRU_MODEL`: model identifier (defaults to `ai-sage/GigaChat3-10B-A1.8B`).
- Cloud.ru endpoint: `https://foundation-models.api.cloud.ru/v1/chat/completions`.

If Cloud.ru is not configured, the previous `AKARIYA_AI_API_KEY` / `AKARIYA_AI_MODEL` setup remains available. No request is sent to a model provider unless a key is supplied.

## Security and limitations

Never add the key to source files, GitHub issues, screenshots, or chat messages. The status endpoint reports provider/model but never the credential.

This initial adapter supports text replies, not remote tool calls. Cloud.ru may charge for requests depending on your plan. Verify the model identifier and API key in your Cloud.ru account. A key for another Cloud.ru service may not authenticate to Foundation Models.

Official documentation: https://cloud.ru/docs/foundation-models/ug/topics/quickstart
