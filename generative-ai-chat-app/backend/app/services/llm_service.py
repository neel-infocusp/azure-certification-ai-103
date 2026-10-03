import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import anyio
import openai
from azure.core.exceptions import ClientAuthenticationError
from fastapi import Request
from openai import AsyncOpenAI

from app.config import Settings
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

# Upstream events that end a streamed answer successfully.
_FINAL_EVENTS = {"response.completed", "response.incomplete"}
_SUMMARY_MAX = 60


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


@dataclass
class StreamEvent:
    """One step of a streamed answer, before it is turned into an SSE frame.

    event is one of: meta, delta, raw, completed, error.
    """

    event: str
    data: dict[str, Any]


def _summarise(event: Any) -> str:
    """A short, human-readable hint of what an upstream event carries (for the Raw events tab)."""
    text = getattr(event, "delta", None)
    if not isinstance(text, str):
        response = getattr(event, "response", None)
        if response is not None:
            text = " ".join(
                str(part) for part in (getattr(response, "id", None), getattr(response, "status", None)) if part
            )
        else:
            text = str(getattr(event, "message", "") or "")
    return text if len(text) <= _SUMMARY_MAX else text[: _SUMMARY_MAX - 3] + "..."


def _failure_message(event: Any) -> str:
    """The reason carried by a response.failed or error event."""
    response = getattr(event, "response", None)
    detail = getattr(getattr(response, "error", None), "message", None) or getattr(
        event, "message", None
    )
    return f"The model could not answer: {detail or 'it reported a failure'}"


async def _close_quietly(stream: Any) -> None:
    """Close the upstream stream, even if this request was just cancelled.

    When the browser disconnects, this code runs inside a cancelled scope where every
    `await` would be cancelled again. The shield lets the close finish, so the model stops
    generating instead of running on unseen.
    """
    close = getattr(stream, "close", None)
    if close is None:
        return
    with anyio.CancelScope(shield=True):
        try:
            await close()
        except Exception:  # noqa: BLE001 - closing is best effort
            logger.debug("Closing the upstream stream failed", exc_info=True)


class LlmService:
    """The only place that talks to the OpenAI SDK (async Responses API)."""

    def __init__(self, client: AsyncOpenAI, settings: Settings) -> None:
        self._client = client
        self._settings = settings

    def _params(self, user_text: str, previous_response_id: str | None) -> dict[str, str]:
        params = {
            "model": self._settings.model_deployment,
            "instructions": self._settings.system_prompt,
            "input": user_text,
        }
        if previous_response_id:
            params["previous_response_id"] = previous_response_id
        return params

    def _request_view(
        self, user_text: str, previous_response_id: str | None, *, stream: bool
    ) -> RequestView:
        return RequestView(
            model=self._settings.model_deployment,
            instructions=self._settings.system_prompt,
            input=user_text,
            previous_response_id=previous_response_id,
            stream=stream,
        )

    async def chat(self, user_text: str, previous_response_id: str | None = None) -> ChatResponse:
        """Ask one question and wait for the whole answer (no streaming)."""
        params = self._params(user_text, previous_response_id)
        stopwatch = Stopwatch()
        try:
            response = await self._client.responses.create(**params)
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
            request=self._request_view(user_text, previous_response_id, stream=False),
            response=ResponseView(id=response.id, status=response.status),
            usage=usage,
            metrics=TurnMetrics(latency_ms=latency_ms),
            raw=response.model_dump(mode="json"),
        )
        return ChatResponse(reply=response.output_text or "", inspector=inspector)

    async def stream_chat(
        self, user_text: str, previous_response_id: str | None = None
    ) -> AsyncIterator[StreamEvent]:
        """Ask one question and yield the answer piece by piece.

        Yields `meta` first, then for every upstream event a `raw` (plus a `delta` when it
        carries text), and finally `completed` or `error`. Never raises: failures become an
        `error` event. If the consumer stops early (aclose or cancellation), the upstream
        stream is closed.
        """
        request_view = self._request_view(user_text, previous_response_id, stream=True)
        yield StreamEvent(
            "meta",
            {"turn_id": f"t_{uuid.uuid4().hex[:8]}", "request": request_view.model_dump()},
        )

        stopwatch = Stopwatch()
        stream: Any = None
        text_parts: list[str] = []
        ttft_ms: int | None = None
        seq = 0
        final: Any = None
        try:
            stream = await self._client.responses.create(
                **self._params(user_text, previous_response_id), stream=True
            )
            async for event in stream:
                seq += 1
                event_type = getattr(event, "type", "")
                yield StreamEvent(
                    "raw", {"seq": seq, "type": event_type, "summary": _summarise(event)}
                )
                if event_type == "response.output_text.delta":
                    if ttft_ms is None:
                        ttft_ms = stopwatch.elapsed_ms()
                    text_parts.append(event.delta)
                    yield StreamEvent("delta", {"text": event.delta})
                elif event_type in _FINAL_EVENTS:
                    final = event.response
                elif event_type in {"response.failed", "error"}:
                    raise ChatError("upstream_error", _failure_message(event), 502)
        except ChatError as error:
            logger.warning("Streamed response failed: %s", error.message)
            yield StreamEvent("error", {"code": error.code, "message": error.message})
            return
        except Exception as exc:  # noqa: BLE001 - everything is mapped to a ChatError
            error = map_exception(exc)
            logger.warning("Streaming failed: %s (%s)", error.code, type(exc).__name__)
            yield StreamEvent("error", {"code": error.code, "message": error.message})
            return
        finally:
            if stream is not None:
                await _close_quietly(stream)

        if final is None:
            yield StreamEvent(
                "error",
                {
                    "code": "upstream_error",
                    "message": "The connection ended before the answer was complete.",
                },
            )
            return

        latency_ms = stopwatch.elapsed_ms()
        usage = normalise_responses_usage(final.usage)
        logger.info(
            "stream done latency_ms=%s ttft_ms=%s chunks=%s output_tokens=%s",
            latency_ms,
            ttft_ms,
            len(text_parts),
            usage.output_tokens,
        )
        inspector = InspectorSnapshot(
            request=request_view,
            response=ResponseView(id=final.id, status=final.status),
            usage=usage,
            metrics=TurnMetrics(
                latency_ms=latency_ms, ttft_ms=ttft_ms, chunk_count=len(text_parts)
            ),
            raw=final.model_dump(mode="json"),
        )
        reply = "".join(text_parts) or (final.output_text or "")
        yield StreamEvent("completed", {"reply": reply, "inspector": inspector})

    async def list_input_items(
        self, response_id: str
    ) -> tuple[list[dict[str, Any]] | None, str | None]:
        """Best effort: what the service stored as the input of a response.

        Returns (items, None) on success or (None, note) when the endpoint can't tell us.
        """
        try:
            page = await self._client.responses.input_items.list(response_id)
            return [item.model_dump(mode="json") for item in page.data], None
        except Exception as exc:  # noqa: BLE001 - optional feature, never fail the request
            logger.info("Could not list input items: %s", type(exc).__name__)
            return None, "The service did not return stored input items for this response."


def get_llm_service(request: Request) -> LlmService:
    """FastAPI dependency: the service created at startup (see main.lifespan).

    Tests override it with a service that uses a fake client.
    """
    service = getattr(request.app.state, "llm", None)
    if service is None:
        raise RuntimeError("The app has not started: the model client is created in the lifespan.")
    return service
