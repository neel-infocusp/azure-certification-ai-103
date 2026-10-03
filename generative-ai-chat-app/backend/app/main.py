import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import AsyncOpenAI
from pydantic import ValidationError

from app.auth import build_auth
from app.config import get_settings
from app.errors import ChatError
from app.routers import chat, health, sessions, stats
from app.schemas import ErrorBody, ErrorResponse
from app.services.llm_service import LlmService
from app.services.stats import StatsCounter

logger = logging.getLogger(__name__)


def _error_response(status_code: int, body: ErrorBody) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=ErrorResponse(error=body).model_dump())


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Create the model client and sign-in once at startup, close them on shutdown.

    The async credential and the OpenAI client each hold open HTTP sessions. Closing them
    here (like the `finally` block in the Microsoft exercise) avoids "unclosed session"
    warnings when the server stops.
    """
    try:
        settings = get_settings()
    except ValidationError as exc:
        missing = ", ".join(str(e["loc"][0]).upper() for e in exc.errors())
        raise RuntimeError(
            f"Missing configuration: {missing}. Copy backend/.env.example to "
            "backend/.env and fill it in."
        ) from exc
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    auth = build_auth(settings)
    client = AsyncOpenAI(base_url=settings.azure_openai_endpoint, api_key=auth.api_key)
    app.state.llm = LlmService(client, settings)
    try:
        yield
    finally:
        logger.info("Shutting down: closing the model client and the sign-in")
        try:
            await client.close()
        finally:
            # Always attempted, even if closing the client failed.
            await auth.close()


def create_app() -> FastAPI:
    app = FastAPI(title="Generative AI Chat App", lifespan=lifespan)
    app.state.stats = StatsCounter()

    # The Vite dev server proxies /api, so CORS is only a safety net.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ChatError)
    async def chat_error_handler(_: Request, exc: ChatError) -> JSONResponse:
        return _error_response(exc.status_code, ErrorBody(code=exc.code, message=exc.message))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        message = str(first.get("msg", "Invalid request.")).removeprefix("Value error, ")
        return _error_response(400, ErrorBody(code="bad_request", message=message))

    app.include_router(health.router)
    app.include_router(stats.router)
    app.include_router(sessions.router)
    app.include_router(chat.router)
    return app


app = create_app()
