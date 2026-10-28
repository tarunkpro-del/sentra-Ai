# 🛡️ SENTRA — Autonomous AI-Powered Website Testing Platform

**Team:** ZYPHER  
**Team Lead:** Tarun Kumar  
**Architecture:** Sentra Multi-Agent Engine v3  

---

## 📌 Overview

**Sentra** is an autonomous AI website quality-assurance platform that deploys **six specialized AI agents** simultaneously across parallel browser contexts. Rather than relying on rigid, pre-recorded scripts, Sentra dynamically discovers site structure, navigates complex multi-step flows (including product search, multi-product cart additions, checkout forms, and seat reservation maps), detects real functional bugs and logic errors, and compiles comprehensive QA audit reports with annotated visual evidence and reproduction steps.

---

## ✨ Key Features

- **Autonomous Dynamic Discovery**: Maps site structure, links, forms, and interactive components on any public or local web application URL without hardcoded selectors.
- **6 Parallel AI Testing Agents**: Dedicated browser tabs execute distinct testing missions concurrently with shared memory and visited-state tracking.
- **End-to-End E-Commerce Flow Testing**: Automatically searches categories, handles product variants, adds multiple products to cart, verifies cart quantity and pricing calculations, and follows delivery and payment stages safely using synthetic test data.
- **Domain-Specific Business Logic Testing**: Validates complex logic such as bus booking seat grids (identifying single-click multi-selection doubling defects), date offsets, pricing bait-and-switch discrepancies, and contradictory alert banners.
- **Visual Evidence & Defect Annotations**: Captures screenshots at key checkpoints, matching each screenshot with expected vs. actual behavior, error status, and reproduction steps.
- **Calibrated Reliability Scoring**: Evaluates real application health (scores >95 for healthy sites; 50–60 for sites with confirmed business logic defects).
- **Real-Time Streaming Dashboard**: Server-Sent Events (SSE) stream live agent actions, console logs, system health, and defect discovery in real-time.

---

## 🤖 The Six Specialized AI Agents

| Agent | Name | Focus & Responsibilities |
|---|---|---|
| **Agent C** | **Navigation & Exploration** | Maps routes, internal links, header menus, category hierarchies, and detects broken links or 404 navigation failures. |
| **Agent D** | **UI & Interactive Controls** | Tests buttons, tabs, dropdowns, filters, search bars with diverse queries, and verifies interactive UI state changes. |
| **Agent E** | **Forms & Input Validation** | Exercises authentication flows, input validation boundaries, empty form submissions, and error message rendering using synthetic test credentials. |
| **Agent F** | **Core Workflow & E-Commerce** | Executes end-to-end shopping journeys: searches products, adds multiple items to cart, verifies quantity updates, fills synthetic checkout address forms, and inspects payment stages. |
| **Agent G** | **Business Logic & Domain Testing** | Verifies domain rules (e.g. bus seat map single-selection vs doubling, route search calculations, price consistency between listings and detail pages). |
| **Agent H** | **Defect Verification & Evidence** | Verifies calculations (subtotal + tax = total), checks for NaN/offset anomalies, reproduces defects, and captures annotated evidence screenshots. |

---

## 🛠️ Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide React, Framer Motion, Vite
- **Backend**: Node.js, Express, Playwright (Headless/Headed Chromium)
- **AI Engine**: Google Gemini API (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`) via adaptive queue with automated fallback
- **Communication**: Server-Sent Events (SSE) for live agent status streaming

---

## 📋 Prerequisites

- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher
- **Google Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/apikey)

---

## 🚀 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/tarunkpro-del/sentra-Ai.git
   cd sentra-Ai
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Install Playwright Chromium browser:**
   ```bash
   npx playwright install chromium
   ```

4. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set your `GEMINI_API_KEY`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-3.5-flash-lite
   ```

---

## 🏃 Running the Platform

### Development Mode (Concurrent Frontend & Backend)
Run both the Express backend and the Vite frontend simultaneously:
```bash
npm run dev
```

- **Frontend Web UI**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:3001](http://localhost:3001)
- **Health Check Endpoint**: [http://localhost:3001/api/health](http://localhost:3001/api/health)

### Production Mode
Build the client and start the production server:
```bash
npm run build
npm start
```
Open [http://localhost:3001](http://localhost:3001) in your browser.

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | **Yes** | — | Google Gemini API Key from Google AI Studio |
| `GEMINI_MODEL` | No | `gemini-3.5-flash-lite` | Primary AI model for agent decision making |
| `PORT` | No | `3001` | Express backend server port |
| `HEADLESS` | No | `true` | Set to `false` to view Chromium browser execution in real time |
| `GEMINI_MAX_CONCURRENT` | No | `3` | Maximum concurrent AI requests |

---

## 🧪 Testing Workflow

1. Navigate to [http://localhost:5173](http://localhost:5173).
2. Enter the target website URL (e.g., `https://www.amazon.in/` or `https://neobustest.vercel.app/`).
3. *(Optional)* Add specific testing instructions or attach a PRD document (`.txt`, `.md`, `.docx`).
4. Click **Start Test**.
5. Observe live real-time exploration across all 6 specialized agents, stream logs, and review the final consolidated QA report.

---

## 📄 License

This project is licensed under the MIT License.
