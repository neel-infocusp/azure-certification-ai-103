import logging
from functools import lru_cache
from typing import Any

import openai
from azure.core.exceptions import ClientAuthenticationError
from openai import OpenAI

from app.auth import build_api_key
from app.config import Settings, get_settings
from app.errors import ChatError
from app.schemas import (
    ChatResponse,
    InspectorSnapshot,
    RequestView,
    ResponseView,
    TurnMetrics,
)
from app.services.metrics import Stopwatch, normalise_responses_usage

logger = logging.getLogger(__name__)


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
    """The only place that talks to the OpenAI SDK (Responses API)."""

    def __init__(self, client: OpenAI, settings: Settings) -> None:
        self._client = client
        self._settings = settings

    def chat(self, user_text: str, previous_response_id: str | None = None) -> ChatResponse:
        """Ask one question. Passing the previous response ID gives the model the earlier chat."""
        instructions = self._settings.system_prompt
        params: dict[str, str] = {
            "model": self._settings.model_deployment,
            "instructions": instructions,
            "input": user_text,
        }
        if previous_response_id:
            params["previous_response_id"] = previous_response_id
        stopwatch = Stopwatch()
        try:
            response = self._client.responses.create(**params)
        except Exception as exc:  # noqa: BLE001 - everything is mapped to a ChatError
            error = map_exception(exc)
            logger.warning("Model call failed: %s (%s)", error.code, type(exc).__name__)
            raise error from exc
        latency_ms = stopwatch.elapsed_ms()

        if response.status == "failed":
            detail = getattr(response.error, "message", None) or "the model reported a failure"
            logger.warning("Response %s failed: %s", response.id, detail)
            raise ChatError("upstream_error", f"The model could not answer: {detail}", 502)

        usage = normalise_responses_usage(response.usage)
        logger.info(
            "turn done latency_ms=%s input_tokens=%s output_tokens=%s",
            latency_ms,
            usage.input_tokens,
            usage.output_tokens,
        )

        inspector = InspectorSnapshot(
            request=RequestView(
                model=self._settings.model_deployment,
                instructions=instructions,
                input=user_text,
                previous_response_id=previous_response_id,
                stream=False,
            ),
            response=ResponseView(id=response.id, status=response.status),
            usage=usage,
            metrics=TurnMetrics(latency_ms=latency_ms),
            raw=response.model_dump(mode="json"),
        )
        return ChatResponse(reply=response.output_text or "", inspector=inspector)


    def list_input_items(self, response_id: str) -> tuple[list[dict[str, Any]] | None, str | None]:
        """Best effort: what the service stored as the input of a response.

        Returns (items, None) on success or (None, note) when the endpoint can't tell us.
        """
        try:
            page = self._client.responses.input_items.list(response_id)
            return [item.model_dump(mode="json") for item in page.data], None
        except Exception as exc:  # noqa: BLE001 - optional feature, never fail the request
            logger.info("Could not list input items: %s", type(exc).__name__)
            return None, "The service did not return stored input items for this response."


@lru_cache
def get_llm_service() -> LlmService:
    """FastAPI dependency. Tests override it with a fake client."""
    settings = get_settings()
    client = OpenAI(
        base_url=settings.azure_openai_endpoint,
        api_key=build_api_key(settings),
    )
    return LlmService(client, settings)
