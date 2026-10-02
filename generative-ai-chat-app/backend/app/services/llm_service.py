import logging
from functools import lru_cache

import openai
from azure.core.exceptions import ClientAuthenticationError
from openai import OpenAI

from app.auth import build_api_key
from app.config import Settings, get_settings
from app.schemas import (
    ChatMessage,
    ChatResponse,
    ErrorCode,
    InspectorSnapshot,
    RequestView,
    ResponseView,
    TurnMetrics,
)
from app.services.metrics import Stopwatch, normalise_chat_usage

logger = logging.getLogger(__name__)


class ChatError(Exception):
    """A failure we can show to the user: stable code, friendly message, HTTP status."""

    def __init__(self, code: ErrorCode, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def map_exception(exc: Exception) -> ChatError:
    """Translate SDK / credential exceptions into a ChatError."""
    if isinstance(exc, ClientAuthenticationError | openai.AuthenticationError):
        return ChatError(
            "auth_failed",
            "Authentication failed. Check AZURE_OPENAI_API_KEY in backend/.env, or run "
            "`az login` if you use Entra ID sign-in.",
            401,
        )
    if isinstance(exc, openai.PermissionDeniedError):
        return ChatError(
            "auth_failed",
            "Access denied. Your account may need the 'Cognitive Services OpenAI User' "
            "role on the Foundry resource.",
            403,
        )
    if isinstance(exc, openai.NotFoundError):
        return ChatError(
            "deployment_not_found",
            "Model deployment not found. Check MODEL_DEPLOYMENT and "
            "AZURE_OPENAI_ENDPOINT in backend/.env.",
            404,
        )
    if isinstance(exc, openai.RateLimitError):
        return ChatError(
            "rate_limited", "Rate limit reached. Wait a moment and try again.", 429
        )
    if isinstance(exc, openai.BadRequestError):
        return ChatError("bad_request", f"The model rejected the request: {exc.message}", 400)
    if isinstance(exc, openai.APIConnectionError):
        return ChatError(
            "upstream_error",
            "Could not reach the Azure OpenAI endpoint. Check AZURE_OPENAI_ENDPOINT "
            "and your network.",
            502,
        )
    if isinstance(exc, openai.OpenAIError):
        return ChatError("upstream_error", f"The model service returned an error: {exc}", 502)
    return ChatError("upstream_error", "Unexpected error while calling the model.", 502)


class LlmService:
    """The only place that talks to the OpenAI SDK (Round 1: Chat Completions)."""

    def __init__(self, client: OpenAI, settings: Settings) -> None:
        self._client = client
        self._settings = settings

    def chat(self, user_text: str) -> ChatResponse:
        messages = [
            {"role": "system", "content": self._settings.system_prompt},
            {"role": "user", "content": user_text},
        ]
        stopwatch = Stopwatch()
        try:
            completion = self._client.chat.completions.create(
                model=self._settings.model_deployment,
                messages=messages,
            )
        except Exception as exc:  # noqa: BLE001 - everything is mapped to a ChatError
            error = map_exception(exc)
            logger.warning("Model call failed: %s (%s)", error.code, type(exc).__name__)
            raise error from exc
        latency_ms = stopwatch.elapsed_ms()

        choice = completion.choices[0] if completion.choices else None
        reply = (choice.message.content if choice else None) or ""
        usage = normalise_chat_usage(completion.usage)

        logger.info(
            "turn done latency_ms=%s input_tokens=%s output_tokens=%s",
            latency_ms,
            usage.input_tokens,
            usage.output_tokens,
        )

        inspector = InspectorSnapshot(
            request=RequestView(
                model=self._settings.model_deployment,
                messages=[ChatMessage(**m) for m in messages],
                stream=False,
            ),
            response=ResponseView(
                id=completion.id,
                finish_reason=choice.finish_reason if choice else None,
            ),
            usage=usage,
            metrics=TurnMetrics(latency_ms=latency_ms),
        )
        return ChatResponse(reply=reply, inspector=inspector)


@lru_cache
def get_llm_service() -> LlmService:
    """FastAPI dependency. Tests override it with a fake client."""
    settings = get_settings()
    client = OpenAI(
        base_url=settings.azure_openai_endpoint,
        api_key=build_api_key(settings),
    )
    return LlmService(client, settings)
