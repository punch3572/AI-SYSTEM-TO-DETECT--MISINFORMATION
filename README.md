# AI System To Detect Misinformation

This project is a browser-based app for analyzing claims, text, and images for misinformation, AI-generated writing patterns, and possible deepfake-style manipulation.

## App Features

- Claim analysis for `True`, `False`, `Misleading`, or `Needs Verification` style outputs
- Text analysis for likely `AI-generated`, `Human-written`, or uncertain content
- Image upload with preview and deepfake-style forensic checks
- Detection hints for suspicious wording, exaggerated claims, and likely misinformation patterns
- Structured JSON output for all analyses
- Deepfake-oriented checks for lighting, texture, background distortion, and image artifact clues
- Local heuristic fallback when live AI analysis is unavailable
- AI-backed analysis through the configured backend when an API key is active
- Browser field for local-use API keys
- Backend status messaging so the app shows whether it is using AI mode or fallback mode

## Project Files

- `index.html` - app layout and UI
- `styles.css` - app styling and responsive layout
- `script.js` - frontend logic, heuristics, and API calls
- `server.js` - local backend server and AI provider integration
- `.env.example` - sample environment configuration

## How To Run

**1**.Create a new folder ,name it as AI-system.

**2**. open the VS CODE in that folder.

**3**.now in VS CODE paste the index.html code which we had provided.

**4**.same like 3rd step do for the {script.js},{style.js},{server.js},{package.json} and {.env.example}

**5**.

1. Start the backend:

```powershell
node server.js
```

2. Open the app in the browser at:

```text
http://localhost:8080
```

## Environment Setup

Create a `.env` file from `.env.example` if you want server-side AI analysis.

Example:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.2
```

## Notes

- The app can use a live AI provider, but it also supports local heuristics when no key is configured.
- Image and misinformation detection are heuristic unless the live AI backend is active.
- `.env` is ignored by Git so local secrets are not committed.
