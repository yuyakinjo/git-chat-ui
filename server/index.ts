import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";

import aiRoutes from "./routes/ai.js";
import branchRoutes from "./routes/branches.js";
import commitRoutes from "./routes/commits.js";
import configRoutes from "./routes/config.js";
import pullRequestRoutes from "./routes/pullRequests.js";
import repositoryRoutes from "./routes/repositories.js";
import stashRoutes from "./routes/stash.js";
import workingTreeRoutes from "./routes/workingTree.js";

const app = express();
const port = Number(process.env.GIT_CHAT_UI_API_PORT || 4141);

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.use(repositoryRoutes);
app.use(branchRoutes);
app.use(commitRoutes);
app.use(workingTreeRoutes);
app.use(stashRoutes);
app.use(pullRequestRoutes);
app.use(configRoutes);
app.use(aiRoutes);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(400).json({ error: message });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[git-chat-ui/api] listening on http://localhost:${port}`);
});
