from typing import Any, Literal

from pydantic import BaseModel, field_validator

MAX_MESSAGE_CHARS = 4000

ErrorCode = Literal[
    "auth_failed",
    "deployment_not_found",
    "rate_limited",
    "bad_request",
    "upstream_error",
]


class ChatRequest(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def message_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message must not be empty.")
        if len(value) > MAX_MESSAGE_CHARS:
            raise ValueError(f"Message must be at most {MAX_MESSAGE_CHARS} characters.")
        return value


class RequestView(BaseModel):
    model: str
    instructions: str
    input: str
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


class MemoryView(BaseModel):
    mode: Literal["none"] = "none"


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
