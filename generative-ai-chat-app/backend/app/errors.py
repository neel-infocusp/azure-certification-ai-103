from app.schemas import ErrorCode


class ChatError(Exception):
    """A failure we can show to the user: stable code, friendly message, HTTP status."""

    def __init__(self, code: ErrorCode, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
