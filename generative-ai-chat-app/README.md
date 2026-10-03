# Generative AI Chat App

A small chat application built on **Microsoft Foundry** and the **OpenAI Python SDK**, with an *inspector* panel that shows what is happening inside the chat: the context sent to the model, conversation memory, token usage and latency.

- **Backend:** Python 3.13 + FastAPI
- **Frontend:** React + Vite + TypeScript (responsive: two panels on desktop, a Chat/Inspector switch on phones; light/dark theme; AI replies rendered as Markdown)
- **Model:** a `gpt-5.2` deployment in a Microsoft Foundry project
- **Auth:** an API key from the Foundry portal (simplest), or Microsoft Entra ID via `az login`

> **Status: Round 3 of 5.** Chat using the Responses API with **conversation memory** (`previous_response_id`), sessions and a Memory tab. Later rounds add streaming and async.

## Prerequisites

- Azure subscription with a Foundry project and a deployed `gpt-5.2` model
- Python 3.13.x (not 3.14), Node.js LTS, Git
- Either the model's **API key** (Foundry portal) **or** the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
  with `az login` (add `--tenant <tenant-id>` if you have several tenants)

## Setup

### 1. Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # then edit .env
```

Edit `backend/.env`:

| Variable | Meaning |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | The **Azure OpenAI endpoint** from the Foundry project home page (not the project endpoint), e.g. `https://<resource>.openai.azure.com/openai/v1/` |
| `MODEL_DEPLOYMENT` | The exact deployment name of your model |
| `AZURE_OPENAI_API_KEY` | Your key from the Foundry portal. **Leave empty to use Entra ID sign-in (`az login`) instead.** |

### 2. Frontend

```powershell
cd frontend
npm install
```

## Run

Two terminals:

```powershell
# terminal 1 - backend (http://localhost:8000, API docs at /docs)
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload --port 8000

# terminal 2 - frontend (http://localhost:5173)
cd frontend
npm run dev
```

Open http://localhost:5173. The header shows the model and a connection status.

Try: `Tell me about the ELIZA chatbot.`, then `How does it compare to modern LLMs?`. The model now understands "it": open the **Memory** tab to see the response chain and transcript, and the **Metrics** tab to see input tokens grow. **New chat** starts a conversation with empty memory.

## Test

```powershell
cd backend;  .venv\Scripts\activate; pytest
cd frontend; npm test; npm run build
```

Backend tests use a fake model client, so they never call Azure.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Authentication failed" | API key: re-copy `AZURE_OPENAI_API_KEY` into `backend/.env`. Entra ID: run `az login` and make sure your account has the *Cognitive Services OpenAI User* role |
| "Model deployment not found" | Check `MODEL_DEPLOYMENT` and `AZURE_OPENAI_ENDPOINT` in `backend/.env` |
| "Backend offline" in the header | Start the backend on port 8000 |
| Backend exits with "Missing configuration" | Create `backend/.env` from `.env.example` |

## Clean-up

Foundry resources cost money. When you finish, delete the resource group in the Azure portal (**Resource group → Delete resource group**).
