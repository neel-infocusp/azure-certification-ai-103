from urllib.parse import urlparse

from fastapi import APIRouter, Depends

from app.config import CURRENT_ROUND, Settings, get_settings
from app.schemas import HealthResponse

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    """Liveness plus config sanity. Never returns secrets or the full endpoint URL."""
    return HealthResponse(
        model_deployment=settings.model_deployment,
        endpoint_host=urlparse(settings.azure_openai_endpoint).netloc,
        round=CURRENT_ROUND,
    )
