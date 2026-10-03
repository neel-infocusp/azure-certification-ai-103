from unittest.mock import AsyncMock, patch

import pytest

from app.auth import Auth, build_auth
from app.config import Settings


def _settings(api_key: str | None) -> Settings:
    return Settings(
        azure_openai_endpoint="https://x.openai.azure.com/openai/v1/",
        model_deployment="gpt-test",
        azure_openai_api_key=api_key,
        _env_file=None,
    )


def test_api_key_is_used_when_configured() -> None:
    with patch("app.auth.DefaultAzureCredential") as credential:
        auth = build_auth(_settings("  secret-key  "))

    assert auth.api_key == "secret-key"
    assert auth.credential is None
    credential.assert_not_called()


@pytest.mark.parametrize("value", [None, "", "   "])
def test_entra_id_is_used_when_key_is_missing_or_blank(value: str | None) -> None:
    with (
        patch("app.auth.DefaultAzureCredential") as credential,
        patch("app.auth.get_bearer_token_provider", return_value="token-provider") as provider,
    ):
        auth = build_auth(_settings(value))

    credential.assert_called_once()
    provider.assert_called_once()
    assert auth.api_key == "token-provider"
    assert auth.credential is credential.return_value


@pytest.mark.anyio
async def test_closing_closes_the_async_credential() -> None:
    credential = AsyncMock()

    await Auth(api_key="token-provider", credential=credential).close()

    credential.close.assert_awaited_once()


@pytest.mark.anyio
async def test_closing_an_api_key_auth_does_nothing() -> None:
    await Auth(api_key="secret-key").close()  # must not raise
