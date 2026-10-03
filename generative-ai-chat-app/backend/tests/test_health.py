from fastapi.testclient import TestClient


def test_health_returns_config_sanity_without_secrets(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "status": "ok",
        "model_deployment": "gpt-test",
        "endpoint_host": "my-resource.openai.azure.com",
        "round": 4,
    }
