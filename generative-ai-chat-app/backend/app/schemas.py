from typing import Any, Literal

from pydantic import BaseModel, field_validator

MAX_MESSAGE_CHARS = 4000

ErrorCode = Literal[
    "auth_failed",
    "deployment_not_found",
    "rate_limited",
    "bad_request",
    "session_not_found",
    "upstream_error",
]


class ChatRequest(BaseModel):
    message: str
    session_id: str

    @field_validator("message")
    @classmethod
    def message_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message must not be empty.")
        if len(value) > MAX_MESSAGE_CHARS:
            raise ValueError(f"Message must be at most {MAX_MESSAGE_CHARS} characters.")
        return value

    @field_validator("session_id")
    @classmethod
    def session_id_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Session id must not be empty.")
        return value


class RequestView(BaseModel):
    model: str
    instructions: str
    input: str
    previous_response_id: str | None = None
    stream: bool = False


class ResponseView(BaseModel):
    id: str | None = None
    status: str | None = None


class Usage(BaseModel):
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    reasoning_tokens: int | None = None
    cached_tokens: int | None = None


class TurnMetrics(BaseModel):
    latency_ms: int


class TranscriptMessage(BaseModel):
    role: str
    content: str


class MemoryView(BaseModel):
    mode: Literal["none", "previous_response_id"] = "none"
    # Server memory: the response IDs the service links together, oldest first.
    response_chain: list[str] = []
    # Our own mirror of the conversation, for display.
    transcript: list[TranscriptMessage] = []


class InspectorSnapshot(BaseModel):
    api: Literal["responses"] = "responses"
    request: RequestView
    response: ResponseView
    usage: Usage
    metrics: TurnMetrics
    memory: MemoryView = MemoryView()
    # The raw Responses API payload of this turn, for the "Raw response" viewer.
    raw: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    reply: str
    inspector: InspectorSnapshot


class SessionCreated(BaseModel):
    session_id: str


class MemoryResponse(BaseModel):
    mode: Literal["previous_response_id"] = "previous_response_id"
    last_response_id: str | None = None
    response_chain: list[str]
    transcript: list[TranscriptMessage]
    # Best effort: input items the service reports for the last response (None = unavailable).
    server_items: list[dict[str, Any]] | None = None
    server_items_note: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    model_deployment: str
    endpoint_host: str
    round: int


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
