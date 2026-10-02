import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache

from app.errors import ChatError

MAX_SESSIONS = 50


@dataclass
class Turn:
    index: int
    user_text: str
    assistant_text: str
    response_id: str
    previous_response_id: str | None


@dataclass
class ChatSession:
    session_id: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    turns: list[Turn] = field(default_factory=list)

    @property
    def last_response_id(self) -> str | None:
        """The ID the next question must point back to (None before the first answer)."""
        return self.turns[-1].response_id if self.turns else None

    @property
    def response_chain(self) -> list[str]:
        return [turn.response_id for turn in self.turns]

    @property
    def transcript(self) -> list[dict[str, str]]:
        """Our own copy of the conversation. The model does not read this, the service does."""
        messages: list[dict[str, str]] = []
        for turn in self.turns:
            messages.append({"role": "user", "content": turn.user_text})
            messages.append({"role": "assistant", "content": turn.assistant_text})
        return messages


class SessionStore:
    """In-memory sessions. Lost on restart; the oldest are dropped past MAX_SESSIONS."""

    def __init__(self, max_sessions: int = MAX_SESSIONS) -> None:
        self._max_sessions = max_sessions
        self._sessions: OrderedDict[str, ChatSession] = OrderedDict()
        self._lock = threading.Lock()

    def create(self) -> ChatSession:
        session = ChatSession(session_id=f"s_{uuid.uuid4().hex[:12]}")
        with self._lock:
            self._sessions[session.session_id] = session
            while len(self._sessions) > self._max_sessions:
                self._sessions.popitem(last=False)
        return session

    def get(self, session_id: str) -> ChatSession:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise ChatError(
                    "session_not_found",
                    "This conversation is no longer known to the server (it may have "
                    "restarted). A new conversation was started.",
                    404,
                )
            self._sessions.move_to_end(session_id)
            return session

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def add_turn(
        self, session_id: str, user_text: str, assistant_text: str, response_id: str
    ) -> ChatSession:
        session = self.get(session_id)
        with self._lock:
            session.turns.append(
                Turn(
                    index=len(session.turns) + 1,
                    user_text=user_text,
                    assistant_text=assistant_text,
                    response_id=response_id,
                    previous_response_id=session.last_response_id,
                )
            )
        return session


@lru_cache
def get_session_store() -> SessionStore:
    """FastAPI dependency. Tests override it with a fresh store."""
    return SessionStore()
