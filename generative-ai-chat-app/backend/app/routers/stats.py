from fastapi import APIRouter, Depends

from app.schemas import StatsResponse
from app.services.stats import StatsCounter, get_stats

router = APIRouter(prefix="/api")


@router.get("/stats", response_model=StatsResponse)
async def stats(counter: StatsCounter = Depends(get_stats)) -> StatsResponse:
    """How busy the backend is: model calls running now, finished so far, average latency."""
    return StatsResponse(
        in_flight=counter.in_flight,
        total_requests=counter.total_requests,
        avg_latency_ms=counter.avg_latency_ms,
    )
