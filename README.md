# ORACLE

**AI-powered code search that actually works.** Index any repository, ask questions in natural language, get accurate answers with file citations — all running locally on CPU.

Solves the "grep doesn't understand intent" problem — keyword search can't answer "How does authentication work?" Oracle can.

[![npm version](https://img.shields.io/npm/v/oracle.svg?style=flat-square)](https://www.npmjs.com/package/oracle)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org)

```bash
npm install -g oracle
oracle index          # Index your repository
oracle ask "How does the config loader work?"
```

Works on Mac, Windows, and Linux. No GPU required.

---

> "Finally, a tool that understands what I'm asking instead of just matching keywords."

> "The syntax highlighting and clickable file citations in the terminal are game-changing."

> "I've tried GitHub Copilot search, Sourcegraph, and grep-based tools. This is the first one that feels like talking to someone who actually read the codebase."

---

**[Why I Built This](#why-i-built-this)** · **[How It Works](#how-it-works)** · **[Commands](#commands)** · **[Features](#features)** · **[Installation](#installation)**

---

## Why I Built This

I spend half my day reading code I didn't write. Other people's repositories, legacy systems, unfamiliar frameworks. I need to answer questions like:

- "How does authentication work in this app?"
- "Where is rate limiting implemented?"
- "What's the flow for processing payments?"

Traditional tools don't work:

- **grep/ripgrep** — Keyword search. Can't understand "how does X work?"
- **GitHub search** — Same problem. I don't know what variable names to search for.
- **IDE symbol search** — Good for "find this function," useless for "explain this subsystem."
- **Reading files manually** — Too slow. Takes hours to build context.
- **LLMs without RAG** — Hallucinate. Make up code that doesn't exist.

So I built Oracle. The missing layer between keyword search and actually understanding a codebase.

**Hybrid RAG** (BM25 keyword + vector semantic search + cross-encoder reranking) finds the right code. **LLM generation** explains it in natural language. **File citations** let you verify every claim. **Local CPU execution** means no vendor lock-in and no sending your code to external APIs for indexing.

This is what code search should have been all along.

— **Vyas**

---

## Who This Is For

- **Engineers joining new codebases** — Onboard 10x faster
- **Open-source contributors** — Understand unfamiliar projects before contributing
- **Documentation writers** — Verify how systems actually work
- **Solo developers** — Navigate your own code months later
- **Anyone tired of grep** — Natural language > regex patterns

---

## Getting Started

### Prerequisites

- **Node.js 20+** ([Download](https://nodejs.org))
- **Any LLM API key** (Anthropic Claude recommended, also supports OpenAI, Ollama)

### Installation

```bash
# Install globally
npm install -g oracle

# Or build from source
git clone https://github.com/chittiv1113/Oracle.git
cd oracle
npm install
npm run build
npm link
```

### Quick Start

```bash
# 1. Set your API key
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# 2. Navigate to any repository
cd ~/projects/my-app

# 3. Index the codebase
oracle index full

# 4. Ask questions
oracle ask "How does the authentication system work?"
oracle ask "Where is error handling implemented?"
oracle ask "What's the difference between User and Profile models?"
```

That's it. No config files, no complex setup, no GPU required.

---

## How It Works

Oracle is a **hybrid RAG (Retrieval-Augmented Generation) pipeline** optimized for code search.

### 1. Indexing

```bash
oracle index full
```

**What happens:**

- **File discovery** — Walks repository, respects `.gitignore`, skips binaries
- **AST chunking** — Parses code into functions/classes via Tree-sitter (100+ languages)
- **Embeddings** — Generates vector embeddings using `bge-small-en-v1.5` (local CPU, no API calls)
- **Hybrid indexing** — Builds both BM25 keyword index (Orama) and vector index (USearch HNSW)
- **SQLite persistence** — Stores everything in `.oracle/` directory

**Incremental updates:**

```bash
oracle index update  # Re-indexes only changed files
```

Uses `git diff` + content hashing for maximum speed.

---

### 2. Retrieval

```bash
oracle ask "How does the config loader work?"
```

**What happens:**

#### Phase 1: Hybrid Search (BM25 + Vector)

- **BM25 keyword search** — Finds chunks matching "config", "loader" (fast, exact)
- **Vector semantic search** — Finds chunks with similar meaning (catches synonyms, related concepts)
- **RRF fusion** — Merges both result sets via Reciprocal Rank Fusion (k=60)

#### Phase 2: Reranking

- **Cross-encoder scoring** — Uses `ms-marco-MiniLM-L-6-v2` ONNX model to score query-chunk relevance
- **Top-N selection** — Returns 5-12 most relevant chunks (default: 12)

#### Phase 3: Generation

- **Secret redaction** — Scans for API keys, tokens, passwords (25 patterns)
- **LLM prompting** — Sends query + chunks to Claude/GPT/Ollama with citation instructions
- **Streaming output** — Displays answer token-by-token with syntax highlighting

**Result:** Accurate answers grounded in your actual codebase, with file:line citations for every claim.

---

### 3. Advanced Features

#### Rich Terminal UI

Answers include:

- **Syntax-highlighted code blocks** (keywords blue, strings green, via `cli-highlight`)
- **Clickable file citations** (VS Code, iTerm2, Windows Terminal support via OSC 8 hyperlinks)
- **Formatted markdown** (headings, lists, bold)

````bash
oracle ask "Show me the authentication flow"

# Output:
# → src/auth/login.ts:42-67  ← Clickable link!
#
# The authentication flow uses JWT tokens:
#
# ```typescript
# export async function login(credentials) {  ← Syntax highlighted
#   ...
# }
# ```
#
# Sources:
# → src/auth/login.ts:42
# → src/middleware/verify-token.ts:15
````

#### Smart Context Bypass

Small repositories (<50K tokens) skip RAG entirely and send the **full codebase** to the LLM:

```bash
oracle ask "Summarize this entire project"

# Small codebase detected (12,453 tokens)
# Sending full repository to LLM (bypassing RAG)
```

Better accuracy when your context fits in Claude's 200K window.

#### Response Caching

Identical questions return instant cached responses:

```bash
oracle ask "How does indexing work?"   # First call: 3.2s
oracle ask "How does indexing work?"   # Second call: 0.1s (cached)

# Output: Using cached response
```

Cache persists across sessions, invalidates automatically on `oracle index update`.

#### Dry-Run Mode

See exactly what gets sent to the LLM **without making an API call**:

```bash
oracle ask "test question" --dry-run

# DRY-RUN MODE - No API call will be made
#
# Prompt that would be sent:
# ────────────────────────────────────────
# <instructions>...</instructions>
# <context>
#   [File: src/auth/login.ts, Lines: 42-67]
#   export async function login() { ... }
# </context>
# <question>test question</question>
# ────────────────────────────────────────
#
# Provider: anthropic
# Model: claude-sonnet-4-5-20250929
# Chunks: 12
# Estimated tokens: ~3,247
```

Perfect for debugging prompts or avoiding token costs during testing.

---

## Commands

### Core Workflow

| Command                 | What it does                               |
| ----------------------- | ------------------------------------------ |
| `oracle index full`     | Index entire repository (first-time setup) |
| `oracle index update`   | Re-index only changed files (incremental)  |
| `oracle ask "question"` | Ask a question, get cited answer           |
| `oracle config`         | Interactive configuration wizard           |

### Index Options

```bash
# Index specific directory (monorepo support)
oracle index full --scope src/backend

# Index from different path
oracle index full /path/to/repo
```

### Ask Options

```bash
# Skip reranking (faster, lower quality)
oracle ask "question" --no-rerank

# Skip cache lookup (always query LLM)
oracle ask "question" --no-cache

# Dry-run mode (show prompt without API call)
oracle ask "question" --dry-run

# Use more chunks for complex questions
oracle ask "question" --top-k 20
```

---

## Features

### Hybrid RAG Pipeline

- **BM25 keyword search** (Orama) — Fast exact matching
- **Vector semantic search** (USearch HNSW + bge-small-en-v1.5) — Understands intent
- **Cross-encoder reranking** (ms-marco-MiniLM-L-6-v2 ONNX) — Best-in-class relevance
- **RRF fusion** (k=60) — Industry-standard result merging

### Rich Terminal UI

- Syntax-highlighted code blocks (`cli-highlight`)
- Clickable file citations (OSC 8 hyperlinks via `terminal-link`)
- Markdown formatting (`marked-terminal`)
- Graceful fallbacks for unsupported terminals

### Performance Optimizations

- **Smart context bypass** — Small repos (<50K tokens) send full codebase to LLM
- **Two-layer caching** — Memory (LRU, 100 entries, 10MB) + disk persistence
- **Incremental indexing** — Only re-processes changed files
- **Parallel search** — BM25 + vector search run concurrently

### Security

- **Secret redaction** — 25 patterns (AWS, OpenAI, GitHub, Stripe, etc.)
- **Local-first** — Embeddings + indexing run on CPU, no external dependencies
- **API key isolation** — Only LLM generation calls external APIs

### Multi-Provider Support

- **Anthropic Claude** (recommended) — Best quality, streaming support
- **OpenAI GPT-4o** — Fast, supports o1 reasoning models
- **Ollama** — 100% local, zero cost, no API key needed

### Cross-Platform

- Windows, macOS, Linux
- Node.js 20+ (ESM-first, pure JavaScript, no native compilation)
- CPU-only (no GPU required)

---

## Configuration

### Environment Variables

```bash
# Anthropic Claude (recommended)
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# OpenAI GPT-4o
export OPENAI_API_KEY="sk-..."

# Ollama (local, free)
export OLLAMA_HOST="http://localhost:11434"

# Cohere (optional - improves reranking quality)
export COHERE_API_KEY="..."
```

### Config File

Create `.oraclerc` in your project directory:

```json
{
  "llm": {
    "provider": "anthropic"
  },
  "anthropic": {
    "apiKey": "sk-ant-api03-...",
    "model": "claude-sonnet-4-5-20250929"
  },
  "cohere": {
    "apiKey": "..."
  }
}
```

**Important:** Add `.oraclerc` to `.gitignore` to protect API keys.

### Provider Selection

```bash
# Interactive wizard (PowerShell users: see Troubleshooting)
oracle config

# Or manually edit .oraclerc with your preferred provider
```

**Supported models:**

| Provider      | Models                                               | Notes                                        |
| ------------- | ---------------------------------------------------- | -------------------------------------------- |
| **Anthropic** | claude-sonnet-4-5, claude-opus-4-6, claude-haiku-4-5 | Streaming, best quality                      |
| **OpenAI**    | gpt-4o, gpt-4o-mini, o1                              | Fast, auto-detects non-streaming models (o1) |
| **Ollama**    | llama3.3, qwen2.5-coder, any local model             | Free, local, no API key                      |

---

## Architecture

### Tech Stack

| Component         | Library                                             | Why                                   |
| ----------------- | --------------------------------------------------- | ------------------------------------- |
| **AST Parsing**   | `web-tree-sitter`                                   | Industry standard, 100+ languages     |
| **BM25 Search**   | `@orama/orama`                                      | Fast keyword search with persistence  |
| **Vector Search** | `usearch` + `@huggingface/transformers`             | CPU-optimized HNSW + local embeddings |
| **Reranking**     | `onnxruntime-node`                                  | Cross-encoder on CPU (no GPU)         |
| **LLM Clients**   | `@anthropic-ai/sdk`, `openai`, `ollama`             | Official SDKs with streaming          |
| **CLI**           | `commander`                                         | Type-safe, extensible                 |
| **UI**            | `cli-highlight`, `marked-terminal`, `terminal-link` | Rich terminal output                  |
| **Storage**       | `better-sqlite3`                                    | Fast, embedded, reliable              |
| **Caching**       | `lru-cache` + `node-persist`                        | Memory + disk persistence             |

### Why This Stack?

**No LangChain.** Thin custom adapters for cleaner dependencies and better control.

**CPU-first.** Every component runs on CPU. Maximum accessibility, zero GPU requirement.

**Performance over simplicity.** Native bindings (`better-sqlite3`, `usearch`, `onnxruntime-node`) for speed. Worth the installation complexity.

**Local embeddings.** `@huggingface/transformers` runs models in Node.js. No Python, no external services.

**Streaming from day one.** LLM responses stream token-by-token. Critical UX for 2-15 second response times.

---

## Why It Works

### 1. Hybrid Search (BM25 + Vector)

Neither keyword nor semantic search alone is sufficient:

- **BM25 only** — Misses synonyms, related concepts, paraphrased queries
- **Vector only** — Misses exact identifiers, rare tokens, technical terms

**Hybrid search** combines both via Reciprocal Rank Fusion (RRF):

```
score(chunk) = 1/(k + rank_bm25(chunk)) + 1/(k + rank_vector(chunk))
```

Where `k=60` (empirically optimal). Best of both worlds.

### 2. Cross-Encoder Reranking

First-stage retrieval (BM25 + vector) casts a wide net (~200 candidates). Reranking uses a **cross-encoder** to score query-chunk pairs directly:

```
Input:  "How does auth work?" [SEP] <chunk content>
Output: 0.87  (relevance score)
```

Cross-encoders are **2-3x more accurate** than bi-encoders (vector search) but too slow for first-stage retrieval. Two-stage pipeline = speed + quality.

### 3. Local CPU Execution

Every ML component runs locally:

- **Embeddings:** `bge-small-en-v1.5` via `@huggingface/transformers` (384-dim, optimized for CPU)
- **Reranking:** `ms-marco-MiniLM-L-6-v2` via ONNX Runtime (industry standard for code search)

**Why local?**

- No vendor lock-in
- No usage limits
- Privacy-preserving (code never leaves your machine for indexing)
- One-time setup cost, zero ongoing inference costs

### 4. AST-Based Chunking

Traditional chunking (split by lines, tokens, characters) breaks code mid-function. Oracle uses **Tree-sitter** to parse code into syntactic units:

```python
# Traditional chunking (bad)
Chunk 1: def authenticate(user):
         """Verify user credentials"""
Chunk 2: if not user:
         return False

# AST chunking (good)
Chunk 1: def authenticate(user):
         """Verify user credentials"""
         if not user:
             return False
         return verify_password(user)
```

**Result:** Chunks are semantically coherent. Better retrieval, better answers.

### 5. Secret Redaction

LLM providers log prompts. Oracle scans for **25 secret patterns** before transmission:

- AWS access keys (`AKIA...`)
- OpenAI API keys (`sk-...`)
- GitHub tokens (`ghp_...`, `gho_...`)
- Stripe keys (`sk_live_...`, `pk_live_...`)
- JWTs, private keys, database URLs, etc.

**Pattern-based + entropy analysis** catches most leaks. Redacted chunks still provide context for retrieval without exposing sensitive data.

---

## Troubleshooting

### Config wizard shows "Running in CI environment"

The `is-ci` package detects PowerShell as CI. Bypass the wizard:

**Option 1: Environment variable (recommended)**

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-api03-YOUR-KEY"
oracle ask "test question"
```

**Option 2: Create `.oraclerc` manually**

```powershell
@"
{
  "llm": { "provider": "anthropic" },
  "anthropic": {
    "apiKey": "sk-ant-api03-YOUR-KEY",
    "model": "claude-sonnet-4-5-20250929"
  }
}
"@ | Out-File -FilePath .oraclerc -Encoding utf8
```

### "BM25 index not found" error

You forgot to index:

```bash
oracle index full  # Not just "oracle index"
```

### ONNX Runtime API version warning (fixed in v0.0.2+)

If you see:

```
The requested API version [24] is not available, only API versions [1, 21] are supported
```

Update to latest version or rebuild:

```bash
cd /path/to/oracle
git pull
npm run build
npm link
```

This warning is non-critical (ONNX falls back gracefully) but v0.0.2+ uses lazy imports to eliminate it.

### Slow embedding generation

First-time indexing computes embeddings on-demand. Subsequent runs are fast (embeddings cached in SQLite).

**Speed up indexing:**

- Use `--scope` to index only relevant directories
- Upgrade to faster CPU
- Wait for GPU support (planned v2 feature)

### High memory usage

USearch HNSW index loads into memory. For large codebases (100K+ chunks):

- Index smaller scope (`--scope src/backend`)
- Increase Node.js heap: `NODE_OPTIONS=--max-old-space-size=4096 oracle index full`

### Clickable links don't work

OSC 8 hyperlinks require:

- **VS Code integrated terminal** (builtin support)
- **iTerm2** (macOS, enable in Preferences → Profiles → Terminal → "Enable support for OSC 8 hyperlinks")
- **Windows Terminal** (builtin support)
- **Hyper terminal** (plugin required)

Basic terminals (cmd, Git Bash) show plain text citations (graceful fallback).

---

## Development

### Build from Source

```bash
git clone https://github.com/chittiv1113/Oracle.git
cd oracle
npm install
npm run build
```

### Run Tests

```bash
npm test            # Run all tests
npm run test:watch  # Watch mode
```

### Development Mode (No Build Required)

```bash
npm run dev -- index full
npm run dev -- ask "test question"
```

Uses `tsx` to run TypeScript directly. Changes reflected instantly.

### Linting & Formatting

```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
npm run format      # Format with Prettier
```

### Project Structure

```
oracle/
├── src/
│   ├── cli/              # CLI commands (index, ask, config)
│   ├── indexing/         # File loading, AST chunking, persistence
│   ├── search/           # BM25, vector, reranking
│   ├── generation/       # LLM providers, caching, token counting
│   ├── config/           # Configuration loader
│   └── ui/               # Terminal UI (syntax highlighting, citations)
├── tests/                # Vitest integration tests
└── package.json
```

---

## Roadmap

### v1.0 (Shipped)

- [x] Hybrid RAG pipeline (BM25 + vector + reranking)
- [x] Multi-provider support (Anthropic, OpenAI, Ollama)
- [x] Rich terminal UI (syntax highlighting, clickable citations)
- [x] Smart context bypass for small repos
- [x] Response caching (memory + disk)
- [x] Dry-run mode

### v1.1 (Planned)

- [ ] Conversation history (multi-turn Q&A)
- [ ] Repository comparison ("How does auth differ between repo A and B?")
- [ ] Export answers to Markdown
- [ ] Web UI (optional, for teams)

### v2.0 (Future)

- [ ] GPU acceleration for embeddings
- [ ] Graph-based code navigation
- [ ] Automatic documentation generation
- [ ] Plugin system for custom chunking strategies
- [ ] Team collaboration features

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Areas we'd love help:**

- Additional language support (Tree-sitter parsers)
- Performance optimizations
- Better reranking models
- UI/UX improvements
- Documentation

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- **Tree-sitter** — AST parsing across 100+ languages
- **Orama** — Fast in-memory BM25 search
- **USearch** — CPU-optimized vector search
- **Hugging Face** — Local embedding models

---

## Links

- **GitHub:** [github.com/chittiv1113/Oracle](https://github.com/chittiv1113/Oracle)
- **Issues:** [github.com/chittiv1113/Oracle/issues](https://github.com/chittiv1113/Oracle/issues)
- **npm:** [npmjs.com/package/oracle](https://npmjs.com/package/oracle)

**Questions?** Open an issue or start a discussion on GitHub.
