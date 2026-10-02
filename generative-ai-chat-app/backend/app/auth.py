from collections.abc import Callable

from azure.identity import DefaultAzureCredential, get_bearer_token_provider

from app.config import Settings

# Same scope the Microsoft exercise uses for Foundry / Azure OpenAI.
TOKEN_SCOPE = "https://ai.azure.com/.default"


def build_token_provider() -> Callable[[], str]:
    """Return a callable that yields a fresh Entra ID bearer token.

    DefaultAzureCredential finds your `az login` session locally. The OpenAI
    client calls the provider before each request, so tokens refresh themselves.
    """
    return get_bearer_token_provider(DefaultAzureCredential(), TOKEN_SCOPE)


def build_api_key(settings: Settings) -> str | Callable[[], str]:
    """Pick how to authenticate: an API key if configured, otherwise Entra ID."""
    key = (settings.azure_openai_api_key or "").strip()
    return key if key else build_token_provider()
