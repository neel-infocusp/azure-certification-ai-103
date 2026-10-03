import logging
from collections.abc import AsyncIterator

import anyio
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.errors import ChatError
from app.schemas import ChatRequest, ChatResponse, MemoryView, TranscriptMessage
from app.services.llm_service import LlmService, get_llm_service
from app.services.session_store import ChatSession, SessionStore, get_session_store
from app.services.sse import format_sse
from app.services.stats import StatsCounter, get_stats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def memory_view(session: ChatSession) -> MemoryView:
    return MemoryView(
        mode="previous_response_id",
        response_chain=session.response_chain,
        transcript=[TranscriptMessage(**m) for m in session.transcript],
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    llm: LlmService = Depends(get_llm_service),
    store: SessionStore = Depends(get_session_store),
    stats: StatsCounter = Depends(get_stats),
) -> ChatResponse:
    """One message in, the whole reply out (no streaming). Kept for tests and as a fallback."""
    session = store.get(request.session_id)
    with stats.track() as call:
        result = await llm.chat(request.message, previous_response_id=session.last_response_id)
        call.succeeded = True

    # Only a successful answer is stored, so our copy never drifts from the server's memory.
    session = store.add_turn(
        request.session_id, request.message, result.reply, result.inspector.response.id or ""
    )
    result.inspector.memory = memory_view(session)
    return result


@router.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    llm: LlmService = Depends(get_llm_service),
    store: SessionStore = Depends(get_session_store),
    stats: StatsCounter = Depends(get_stats),
) -> StreamingResponse:
    """Like /api/chat, but the answer arrives as Server-Sent Events while it is written."""
    # Looked up before streaming starts, so an unknown session is a normal JSON 404.
    session = store.get(request.session_id)
    previous_response_id = session.last_response_id

    async def events() -> AsyncIterator[str]:
        """The response body. If the browser disconnects (Stop, New chat, closed tab) this is
        cancelled, and the `finally` closes the model stream so it stops generating."""
        stream = llm.stream_chat(request.message, previous_response_id=previous_response_id)
        try:
            with stats.track() as call:
                async for item in stream:
                    if item.event != "completed":
                        yield format_sse(item.event, item.data)
                        continue

                    inspector = item.data["inspector"]
                    reply = item.data["reply"]
                    # Only a finished answer is stored, so a stopped or failed stream leaves
                    # the conversation exactly as it was.
                    updated = store.add_turn(
                        request.session_id, request.message, reply, inspector.response.id or ""
                    )
                    call.succeeded = True
                    inspector.memory = memory_view(updated)
                    yield format_sse(
                        "completed",
                        {"reply": reply, "inspector": inspector.model_dump(mode="json")},
                    )
        except ChatError as error:  # e.g. the session was deleted while streaming
            yield format_sse("error", {"code": error.code, "message": error.message})
        except Exception:  # noqa: BLE001 - the stream is already open, so report in-band
            logger.exception("Unexpected error while streaming")
            yield format_sse(
                "error",
                {"code": "upstream_error", "message": "Unexpected error while streaming."},
            )
        finally:
            # Shielded: on a disconnect we are inside a cancelled scope, and the inner
            # generator still has to close the upstream stream.
            with anyio.CancelScope(shield=True):
                await stream.aclose()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
