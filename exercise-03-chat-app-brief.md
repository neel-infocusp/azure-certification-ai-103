# Exercise Brief: "Create a Generative AI Chat App"

**Course:** AI-103T00 – Develop AI apps and agents on Azure
**Module:** 1 – Develop generative AI apps in Azure
**Exercise link:** https://microsoftlearning.github.io/mslearn-ai-studio/Instructions/Exercises/03-foundry-sdk.html
**Time the lab says it takes:** about 45 minutes

---

## 1. What is this exercise, in plain words?

You will build a **small chat program that runs in your terminal** (a black text window). You type a question, and an AI model living in Microsoft's cloud answers it. Think of it as a tiny, text-only ChatGPT that you wire up yourself.

You don't build it all at once. You build it in **5 rounds**, and each round adds one new ability:

| Round | What the app can do after this round |
|---|---|
| 1 | Ask a question, get an answer (the "classic" way). |
| 2 | Same thing, but using Microsoft/OpenAI's newer, simpler way. |
| 3 | **Remembers** what you said earlier in the chat. |
| 4 | Answers appear **word by word** (like typing), instead of all at once. |
| 5 | A second version of the app that can do other work **while waiting** for the AI (called "async"). |

The point of the lab is to teach you how a developer talks to an AI model from code.

---

## 2. Words you'll see, explained simply

| Term | What it means in everyday language |
|---|---|
| **Microsoft Foundry** | Microsoft's website/platform for building AI apps. Think of it as a workshop with AI models on the shelves. The site is ai.azure.com. |
| **Project** | Your own workspace inside Foundry. Everything you create for this lab lives here. |
| **Model** | The "AI brain". In this lab it's one called **gpt-5.2**. |
| **Deployment** | Taking a model off the shelf and switching it on for you to use. Like renting your own copy of the brain. It gets a **deployment name** you'll need later. |
| **Endpoint** | The web address your code sends questions to. Like the phone number of your AI. |
| **Entra ID login** | Signing in with your Azure account (no password stored in code). The lab prefers this over an **API key** (a secret password you paste into code), because it's safer. |
| **Azure CLI (`az`)** | A command-line tool used to sign in to Azure from your terminal (`az login`). |
| **Chat Completions API** | The older, widely used way to send a chat to the AI. You send a list of messages (a "system" message that sets the AI's behavior + your "user" message). |
| **Responses API** | The newer, simpler way. You say "here are the instructions" and "here's the user's question". It can also remember the conversation for you. |
| **`previous_response_id`** | A "receipt number" of the AI's last answer. You hand it back with your next question so the AI knows what you were talking about. |
| **Streaming** | The AI sends its answer in small pieces as it writes, so you see text appear gradually instead of waiting for the whole thing. |
| **Async (asynchronous)** | A way of writing code so the program doesn't freeze while waiting for the AI. Like putting the kettle on and doing other things until it whistles. |
| **Virtual environment (venv)** | A private box of Python tools just for this project, so it doesn't mess with the rest of your computer. |
| **`.env` file** | A small settings file holding your endpoint and deployment name. |

---

## 3. Requirements: what you have to build

The lab gives you starter files with gaps (marked by comments like `# Get a response`). **Your job is to fill in those gaps.** You are not writing the app from scratch.

The starter files are in the folder `labfiles/foundry-chat/python/chat-app` of the lab's GitHub repo:

- `.env` – settings (you fill in the endpoint and deployment name)
- `requirements.txt` – list of Python packages to install
- `chat-app.py` – the main app (rounds 1–4)
- `chat-async.py` – the async version (round 5)

### Round 1 – Basic chat using Chat Completions
- Connect to the AI using your Azure sign-in (no API key).
- Send a "system" message ("You are a helpful AI assistant…") plus the user's typed question.
- Print the AI's reply.

### Round 2 – Switch to the Responses API
- Replace the Round 1 code with the simpler Responses call (`instructions` + `input`).
- Print the reply. (At this point the app still has **no memory**. That's expected and is part of the lesson.)

### Round 3 – Add conversation memory
- Create a variable to hold the ID of the last response.
- Pass that ID with every new question so the AI remembers the chat.
- Save the new response's ID after every answer.

### Round 4 – Add streaming
- Ask the API to stream the answer.
- Print each little piece of text as it arrives, and capture the response ID when the answer finishes.

### Round 5 – Async version (separate file `chat-async.py`)
- Use the async versions of the OpenAI client and the Azure sign-in.
- Await the AI's reply, print it, and keep memory working.
- Properly close the sign-in connection at the end (in the `finally` block).

### Always
- Type `quit` to exit the app.
- Be careful with **Python indentation** when pasting code (Python is picky about spaces).

---

## 4. Acceptance criteria: how you know you're done

Tick these off as you go.

**Round 1 – Chat Completions**
- [ ] Running `python chat-app.py` starts the app without errors.
- [ ] Typing `Tell me about the ELIZA chatbot.` returns an answer about the 1960s ELIZA chatbot.
- [ ] Typing `quit` ends the app.

**Round 2 – Responses API**
- [ ] Same question still works.
- [ ] Then typing `How does it compare to modern LLMs?` makes the app say it doesn't understand what "it" is. This is the **expected** result. It proves the app has no memory yet.

**Round 3 – Memory**
- [ ] Same two questions in a row now work: the AI understands that "it" means ELIZA and compares it with modern LLMs.
- [ ] The second answer may be long and the app may look frozen for a few seconds. That's normal at this stage.

**Round 4 – Streaming**
- [ ] The answer to each question appears **gradually**, in chunks, rather than all at once.
- [ ] Memory still works on the follow-up question.

**Round 5 – Async**
- [ ] Running `python chat-async.py` and typing `Tell me about the Turing test.` returns an answer after a short wait.
- [ ] Typing `quit` ends the app cleanly (no error messages).

**Clean-up (after you're done)**
- [ ] The Azure **resource group** used for the lab is deleted, so you don't get charged.

---

## 5. Prerequisites: what you need before starting

### A. Things to have on your computer
- [ ] An **active Azure subscription** (an Azure account with billing/credits set up).
- [ ] **Visual Studio Code** (the code editor), with the **Python extension** installed.
- [ ] **Python 3.13.x** (for example 3.13.12). **Do not use 3.14.** The lab's packages aren't ready for it yet.
- [ ] **Git** installed and set up.
- [ ] **Azure CLI** installed (so `az login` works).

### B. Things to create in Azure / Foundry
- [ ] **A Foundry project**
  - Go to https://ai.azure.com and sign in.
  - Turn on the **"New Foundry"** toggle in the top bar.
  - Create a new project with a unique name.
  - Under *Advanced options*: keep the default Foundry resource name, pick your subscription, create or pick a **resource group**, and choose a region from Foundry's *recommended* list.
- [ ] **A deployed model: `gpt-5.2`**
  - In Foundry go to **Discover → Models**, search for `gpt-5.2`, and deploy it with the **default settings**.
  - Write down the exact **deployment name**. You will paste it into `.env`.
- [ ] **The endpoint**
  - Copy the **Azure OpenAI endpoint** from your project's home page.
  - ⚠️ Use the *Azure OpenAI endpoint*, **not** the "project endpoint". They look different and the lab only works with the first.

### C. Things to set up on your computer
- [ ] Clone the lab repo: `https://github.com/microsoftlearning/mslearn-ai-studio` (in VS Code: `Ctrl+Shift+P` → `Git: Clone`).
- [ ] Create a Python **virtual environment** (venv) using Python 3.13 (`Ctrl+Shift+P` → `Python: Select Interpreter`).
- [ ] Open a terminal in `labfiles/foundry-chat/python/chat-app` and make sure it shows `(.venv)` at the start of the line.
- [ ] Install the packages: `pip install -r requirements.txt`
- [ ] Edit the `.env` file: paste in the **endpoint** and the **deployment name** (`MODEL_DEPLOYMENT`).
- [ ] Sign in to Azure: `az login` (if you have several Azure tenants you may need `az login --tenant <your-tenant-id>`).

### D. Do I need an "agent"?
**No.** You mentioned an agent being deployed, but this exercise only needs a **deployed model** (gpt-5.2). There is no agent in this lab. Agents come later in the course (the next module is about building AI agents).

---

## 6. Heads-ups and common gotchas

- **Sign-in, not keys:** the app uses your Azure login. If `az login` isn't done (or expired), the app will fail with an authentication error.
- **Exact deployment name:** the name in `.env` must match what you see in Foundry. A typo causes a "model not found" style error.
- **Wrong endpoint:** using the project endpoint instead of the Azure OpenAI endpoint is the most likely reason for errors.
- **Python version:** 3.14 can break the package install. Stick with 3.13.
- **Region/quota:** if `gpt-5.2` isn't available or has no quota in your chosen region, pick another region from the recommended list.
- **Indentation:** pasted code must line up with the surrounding code, or Python will complain.
- **Cost:** deployed models and resources can cost money, so do the clean-up at the end.

---

## 7. Clean-up (end of the exercise)

1. Open the **Azure portal** and find the resource group you used.
2. Click **Delete resource group** on the toolbar.
3. Type the resource group name to confirm, then delete.

---

## 8. Quick summary

You'll set up an AI model in Microsoft Foundry, then build a terminal chat app in Python that: talks to it → remembers the conversation → streams answers live → and has an async version. Success means each of the round-by-round checks in Section 4 behaves as described.

---

## 9. Questions for you before we move on

1. Do you already have a Foundry project and a `gpt-5.2` deployment, or should we start from scratch?
2. Do you have Python 3.13, Git, Azure CLI and VS Code installed already?
3. Would you like the next step to be a **step-by-step walkthrough** (I guide you), or should I **write the completed code** in this repo for you to compare with?
