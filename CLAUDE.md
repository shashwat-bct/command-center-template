@AGENTS.md

## AI engine logos

Engine logos live in `public/engine-icons/<name>.svg` and are mapped from engine id in `ENGINE_ICON` (`public/ai-visibility.js`). Every engine label (answer rows, live run, engine pickers, "Ask it yourself" links) renders through `engIcon(id, label)`; an id with no mapping falls back to a lettered badge, so a new engine works before its logo exists.

TODO when the data lands: add logos for **Perplexity**, **Copilot** and **Google AI Mode** once their answers are captured (they were dropped because the Bright Data scrapers never finished):
1. Save the mark as `public/engine-icons/<name>.svg` in the brand colour (Perplexity: `simple-icons` has `perplexity.svg`, #1FB8CD; Copilot: Microsoft's Copilot mark, not GitHub Copilot).
2. Add the engine id(s) to `ENGINE_ICON`, e.g. `perplexity: "perplexity"`, `copilot: "copilot"`, `googleAiMode: "google-ai-mode"`.
