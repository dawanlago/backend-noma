import express from "express";
import cors from "cors";
import path from "path";
import { corsOptions } from "./config/cors";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";

export const app = express();

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

app.use("/api/uploads", express.static(path.resolve(process.cwd(), "uploads")));

app.get("/", (_req, res) => {
  res.json({ service: "backend-noma", docs: "/api/health" });
});

app.use("/api", routes);
app.use(errorHandler);
