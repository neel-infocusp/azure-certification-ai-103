from unittest.mock import patch

from app.auth import build_api_key
from app.config import Settings


def _settings(api_key: str | None) -> Settings:
    return Settings(
        azure_openai_endpoint="https://x.openai.azure.com/openai/v1/",
        model_deployment="gpt-test",
        azure_openai_api_key=api_key,
        _env_file=None,
    )


def test_api_key_is_used_when_configured() -> None:
    with patch("app.auth.build_token_provider") as entra:
        assert build_api_key(_settings("  secret-key  ")) == "secret-key"
        entra.assert_not_called()


def test_entra_id_is_used_when_key_is_missing_or_blank() -> None:
    for value in (None, "", "   "):
        with patch("app.auth.build_token_provider", return_value=lambda: "token") as entra:
            result = build_api_key(_settings(value))
            entra.assert_called_once()
            assert callable(result)
