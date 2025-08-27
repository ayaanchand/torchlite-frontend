# Torchlite Frontend  

Torchlite is AstroLabs’ internal knowledge assistant frontend. It provides a simple chat interface that connects to the backend (FastAPI + Supabase) and delivers grounded answers from internal knowledge sources.  

---

## 🚀 Overview  

- **Framework:** Next.js (React, TypeScript, Tailwind)  
- **Hosting:** Vercel (Frontend)  
- **Backend:** FastAPI served with Uvicorn (Cloud Run/Render)  
- **Integration:** Connects to backend via `RAG_BACKEND_URL`  

---

## ⚙️ Setup  

### Prerequisites  
- Node.js 18+ (check with `node -v`)  
- npm (comes with Node)  

### Clone, Install, Run Locally, Deploy  

```bash
# Clone & install
git clone <repo-url> torchlite-frontend
cd torchlite-frontend
npm install

# Run locally
npm run dev
# open http://localhost:3000

# Deploy (Vercel)
# 1. Push repo to GitHub
# 2. In Vercel: New Project → Import Repo
# 3. Set RAG_BACKEND_URL in Environment Variables
# 4. Deploy → Vercel will auto-build & host the app

