import express from "express";
import cors from "cors";
import { corsOptions } from "./config/cors";
import { bootstrapApp } from "./lib/bootstrap";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";

export const app = express();

app.use((_req, _res, next) => {
  void bootstrapApp().then(() => next()).catch(next);
});

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "10mb" }));


app.get("/", (_req, res) => {
  res.json({ service: "backend-noma", docs: "/api/health" });
});

app.use("/api", routes);
app.use(errorHandler);

export default app;
