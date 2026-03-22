# 🛡️ Sentinel LSP: Autonomous AI Testing Agent

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS_Code-0078D4?style=for-the-badge&logo=visual%20studio%20code&logoColor=white)](https://code.visualstudio.com/)
[![Vitest](https://img.shields.io/badge/Vitest-729B1B?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

**An autonomous, self-healing Test-Driven Development (TDD) agent that lives directly inside your IDE.**

Sentinel LSP is a distributed Visual Studio Code extension engineered to eliminate the friction of writing and maintaining unit tests. Powered by a multi-agent **LangGraph** architecture, Abstract Syntax Tree (**AST**) parsing, and a custom Language Server Protocol (**LSP**), Sentinel watches your keystrokes, autonomously generates highly accurate `Vitest` unit tests, and heals broken tests in the background the moment your source code changes.

---

## 📸 See it in Action

![Sentinel Demo](media/placeholder-heatmap-gif.gif) 
*(Note: Add an animated GIF here showing the live green/red coverage heatmap and the AI generating a test!)*

---

## ✨ Core Architecture & Features

### 🧠 Autonomous Code Healing (LangGraph)
Tests shouldn't break just because you renamed a variable. Sentinel features a multi-agent LangGraph loop that intercepts Vitest crash logs in the background, analyzes why the test failed against your new source code, and autonomously rewrites the test file to achieve a green build—all without human intervention.

### 🔍 Zero-Hallucination Dependency Mocks (AST Scanner)
Unlike standard AI coding assistants that guess or hallucinate database methods, Sentinel utilizes `ts-morph` to physically scan your local file system before prompting the LLM. It extracts deterministic interfaces, classes, and exported functions from your dependencies, injecting an exact "Mocking Context" into the AI to ensure **100% type-safe** dependency mocking.

### ⚡ Background Regression Watcher (LSP)
Built on a robust Client-Server LSP architecture, the Sentinel Server operates entirely in the background. Every time you hit `Save`, the background watcher silently runs targeted Vitest regression maps. If a business rule is violated, it pushes immediate native VS Code diagnostics (red squiggly lines) to the exact line of code that caused the failure without blocking the main UI thread.

### 🎨 Live Coverage Heatmap UI
Sentinel translates machine-readable `coverage-final.json` data into native VS Code Editor Decorators. The moment your tests run, the editor background is instantly painted:
* 🟢 **Green:** Executed and validated by the test suite.
* 🔴 **Red:** Logic missed by the current tests.

### 🎛️ Command Center Dashboard
A custom Activity Bar Webview dashboard that tracks the real-time status of the LangGraph agents, LSP connections, and AST parsers.

---

## 🛠️ Tech Stack

* **Core:** TypeScript, Node.js
* **Extension Framework:** VS Code Extension API, Language Server Protocol (LSP)
* **AI & Reasoning:** LangGraph, Google Gemini API
* **Static Analysis:** `ts-morph` (TypeScript Compiler API)
* **Testing Engine:** Vitest

---

## 🚀 Installation & Setup

1. Clone this repository to your local machine.
2. Ensure you have `Node.js` and `npm` installed.
3. Install dependencies:
   ```bash
   npm install
4. Create a .env file in the root directory and securely add your Gemini API Key:
   ```bash
   GEMINI_API_KEY=your_api_key_here
5. Press F5 in VS Code to launch the Extension Development Host.
6. Open any TypeScript file, open the Command Palette (Cmd+Shift+P), and run ✨ Sentinel: Generate Unit Test.
