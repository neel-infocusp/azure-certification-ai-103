from fastapi import APIRouter, Depends

from app.schemas import ChatRequest, ChatResponse
from app.services.llm_service import LlmService, get_llm_service

router = APIRouter(prefix="/api")


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, llm: LlmService = Depends(get_llm_service)) -> ChatResponse:
    """Rounds 1-2: one message in, one reply out. Nothing is remembered between calls."""
    return llm.chat(request.message)
