import json
from typing import Any


def format_sse(event: str, data: Any) -> str:
    """Format one Server-Sent Event frame: `event:` + `data:` lines and a blank line.

    The data is JSON on a single line (JSON escapes newlines), so a frame never splits.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
