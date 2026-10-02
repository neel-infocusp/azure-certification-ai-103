from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful AI assistant that answers questions and provides information."
)

# Which round of the exercise this build implements (shown in the UI header).
CURRENT_ROUND = 1


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    azure_openai_endpoint: str
    model_deployment: str
    # Optional. When set, it is used instead of the Entra ID sign-in (az login).
    azure_openai_api_key: str | None = None
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
