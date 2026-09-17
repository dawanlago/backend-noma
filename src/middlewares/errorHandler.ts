import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err instanceof Error ? err.message : err);

  if (err.name === "ValidationError") {
    res.status(400).json({ error: err.message });
    return;
  }

  if (err.code === 11000) {
    res.status(409).json({ error: "Registro duplicado." });
    return;
  }

  res.status(500).json({
    error: err instanceof Error ? err.message : "Internal server error",
  });
};
