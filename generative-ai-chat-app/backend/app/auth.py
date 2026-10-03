from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider

from app.config import Settings

# Same scope the Microsoft exercise uses for Foundry / Azure OpenAI.
TOKEN_SCOPE = "https://ai.azure.com/.default"

ApiKey = str | Callable[[], Awaitable[str]]


@dataclass
class Auth:
    """How we sign in to the model service, plus whatever must be closed on shutdown."""

    api_key: ApiKey
    credential: DefaultAzureCredential | None = None

    async def close(self) -> None:
        """Close the async credential's HTTP session (nothing to do for an API key)."""
        if self.credential is not None:
            await self.credential.close()


def build_auth(settings: Settings) -> Auth:
    """Pick how to authenticate: an API key if configured, otherwise Entra ID.

    With Entra ID, DefaultAzureCredential finds your `az login` session locally. The OpenAI
    client awaits the token provider before each request, so tokens refresh themselves.
    The credential owns an HTTP session, so the caller must `await auth.close()`.
    """
    key = (settings.azure_openai_api_key or "").strip()
    if key:
        return Auth(api_key=key)
    credential = DefaultAzureCredential()
    return Auth(
        api_key=get_bearer_token_provider(credential, TOKEN_SCOPE),
        credential=credential,
    )
