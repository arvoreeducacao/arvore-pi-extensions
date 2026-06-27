import express from "express";
import { requireAuth } from "./auth.js";
import { registerDevAuth } from "./dev-auth.js";
import { OpenAIEmbedder } from "./adapters/openai-embedder.js";
import { QdrantVectorStore } from "./adapters/qdrant-store.js";
import { CodebaseService } from "./service.js";

async function main(): Promise<void> {
  const embedder = new OpenAIEmbedder();
  const store = new QdrantVectorStore();
  const service = new CodebaseService(store, embedder);
  await service.init();

  const app = express();
  app.use(express.json({ limit: "32mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  if (process.env.ENABLE_DEV_AUTH === "true") {
    registerDevAuth(app);
  }

  const api = express.Router();
  api.use(requireAuth);

  api.post("/sync", async (req, res) => {
    const result = await service.sync(req.user!, req.body.repos ?? []);
    res.json(result);
  });

  api.post("/index", async (req, res) => {
    const result = await service.index(req.user!, req.body.chunks ?? [], req.body.remove);
    res.json(result);
  });

  api.post("/search", async (req, res) => {
    const result = await service.search(req.user!, req.body.query, {
      repo: req.body.repo,
      lang: req.body.lang,
      limit: req.body.limit,
    });
    res.json(result);
  });

  app.use("/codebase-index", api);

  const port = Number(process.env.PORT || 8080);
  app.listen(port, () => {
    console.log(`codebase-index reference backend listening on :${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
