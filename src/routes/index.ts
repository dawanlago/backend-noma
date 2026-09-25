import { Router } from "express";
import { Company, Contact, Label, Lead, Product, User } from "../models";
import { getHealth } from "../controllers/health.controller";
import { login, me } from "../controllers/auth.controller";
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../controllers/crud.controller";
import { createOwned, deleteOwned, getOwned, listOwned, updateOwned } from "../controllers/owned.controller";
import { getDashboard } from "../controllers/dashboard.controller";
import { createUser, updateUser } from "../controllers/user.controller";
import {
  createEntry,
  deleteEntry,
  getYearSummary,
  listEntries,
  setGoal,
  updateEntry,
} from "../controllers/finance.controller";
import {
  createToolDocument,
  deleteToolDocument,
  duplicateToolDocument,
  getToolDocument,
  listToolDocuments,
  updateToolDocument,
} from "../controllers/tool.controller";
import { listLibrary, updateLibraryCategory } from "../controllers/library.controller";
import { requireAdmin, requireAuth } from "../middlewares/auth";

const router = Router();

router.get("/health", getHealth);
router.post("/auth/login", login);
router.get("/auth/me", requireAuth, me);

router.use(requireAuth);

router.get("/dashboard", getDashboard);

router.get("/users", listDocuments(User));
router.post("/users", requireAdmin, createUser);
router.get("/users/:id", getDocument(User));
router.patch("/users/:id", requireAdmin, updateUser);
router.delete("/users/:id", requireAdmin, deleteDocument(User));

router.get("/companies", listDocuments(Company));
router.post("/companies", createDocument(Company));
router.get("/companies/:id", getDocument(Company));
router.patch("/companies/:id", updateDocument(Company));
router.delete("/companies/:id", deleteDocument(Company));

router.get("/contacts", listDocuments(Contact));
router.post("/contacts", createDocument(Contact));
router.get("/contacts/:id", getDocument(Contact));
router.patch("/contacts/:id", updateDocument(Contact));
router.delete("/contacts/:id", deleteDocument(Contact));

router.get("/products", listDocuments(Product));
router.post("/products", createDocument(Product));
router.get("/products/:id", getDocument(Product));
router.patch("/products/:id", updateDocument(Product));
router.delete("/products/:id", deleteDocument(Product));

router.get("/labels", listDocuments(Label));
router.post("/labels", createDocument(Label));
router.get("/labels/:id", getDocument(Label));
router.patch("/labels/:id", updateDocument(Label));
router.delete("/labels/:id", deleteDocument(Label));

router.get("/leads", listOwned(Lead));
router.post("/leads", createOwned(Lead));
router.get("/leads/:id", getOwned(Lead));
router.patch("/leads/:id", updateOwned(Lead));
router.delete("/leads/:id", deleteOwned(Lead));

router.get("/finance/entries", listEntries);
router.post("/finance/entries", createEntry);
router.patch("/finance/entries/:id", updateEntry);
router.delete("/finance/entries/:id", deleteEntry);
router.get("/finance/summary", getYearSummary);
router.put("/finance/goals/:month", setGoal);

router.get("/tools/:tool/documents", listToolDocuments);
router.post("/tools/:tool/documents", createToolDocument);
router.get("/tools/:tool/documents/:id", getToolDocument);
router.patch("/tools/:tool/documents/:id", updateToolDocument);
router.delete("/tools/:tool/documents/:id", deleteToolDocument);
router.post("/tools/:tool/documents/:id/duplicate", duplicateToolDocument);

router.get("/library", listLibrary);
router.patch("/library/:id", requireAdmin, updateLibraryCategory);

export default router;
