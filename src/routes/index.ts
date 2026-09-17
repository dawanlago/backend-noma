import { Router } from "express";
import {
  Company,
  Contact,
  Funnel,
  Label,
  NPSRating,
  NPSSurvey,
  Product,
  User,
} from "../models";
import { getHealth } from "../controllers/health.controller";
import { login, me } from "../controllers/auth.controller";
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../controllers/crud.controller";
import {
  addDealNote,
  addDealFile,
  createDeal,
  deleteDeal,
  generateDealDossier,
  getDeal,
  getDealDossier,
  getKanban,
  listDeals,
  removeDealFile,
  updateDeal,
  updateDealDossier,
  updateDealStage,
} from "../controllers/deal.controller";
import { getDashboard } from "../controllers/dashboard.controller";
import { createUser, updateUser } from "../controllers/user.controller";
import {
  createTask,
  deleteTask,
  listTasks,
  toggleTask,
  updateTask,
  updateTaskStatus,
} from "../controllers/task.controller";
import {
  createFinancialCategory,
  createTransaction,
  deleteFinancialCategory,
  getFinanceDashboard,
  listFinancialCategories,
  listTransactions,
  updateFinancialCategory,
} from "../controllers/transaction.controller";
import {
  intakeInstagramLead,
  intakeLandingPageLead,
  intakeWhatsAppLead,
} from "../controllers/intake.controller";
import {
  createDealFormInvite,
  createForm,
  getForm,
  getPublicForm,
  getPublicFormInvite,
  listDealFormResponses,
  listForms,
  submitForm,
  submitFormInvite,
  updateForm,
} from "../controllers/form.controller";
import {
  createNpsInvite,
  getPublicNpsInvite,
  listNpsRatings,
  respondPublicNpsInvite,
} from "../controllers/nps.controller";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notification.controller";
import {
  createNote,
  createNoteGroup,
  deleteNote,
  deleteNoteGroup,
  getNote,
  listNoteGroups,
  listNotes,
  shareNote,
  unshareNote,
  updateNote,
  updateNoteGroup,
} from "../controllers/note.controller";
import {
  disconnectGoogle,
  getGoogleConnectUrl,
  getGoogleStatus,
  googleCallback,
} from "../controllers/google.controller";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { requireWebhookSecret } from "../middlewares/webhookAuth";
import Form from "../models/Form";
import Transaction from "../models/Transaction";

const router = Router();

router.get("/health", getHealth);
router.post("/auth/login", login);
router.get("/auth/google/callback", googleCallback);

router.post("/webhooks/leads/whatsapp", requireWebhookSecret, intakeWhatsAppLead);
router.post("/webhooks/leads/instagram", requireWebhookSecret, intakeInstagramLead);
router.post("/webhooks/leads/landing-page", requireWebhookSecret, intakeLandingPageLead);
router.post("/forms/:id/submit", submitForm);
router.get("/forms/:id/public", getPublicForm);
router.get("/form-invites/:code", getPublicFormInvite);
router.post("/form-invites/:code/submit", submitFormInvite);

router.get("/nps/invites/:token", getPublicNpsInvite);
router.post("/nps/invites/:token/respond", respondPublicNpsInvite);

router.get("/auth/me", requireAuth, me);

router.use(requireAuth);

router.get("/dashboard", getDashboard);

router.get("/notifications", listNotifications);
router.post("/notifications/read-all", markAllNotificationsRead);
router.patch("/notifications/:id/read", markNotificationRead);

router.get("/users", listDocuments(User));
router.post("/users", createUser);
router.get("/users/:id", getDocument(User));
router.patch("/users/:id", updateUser);
router.delete("/users/:id", deleteDocument(User));

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

router.get("/funnels/:funnelId/kanban", getKanban);
router.get("/funnels", listDocuments(Funnel));
router.post("/funnels", createDocument(Funnel));
router.get("/funnels/:id", getDocument(Funnel));
router.patch("/funnels/:id", updateDocument(Funnel));
router.delete("/funnels/:id", deleteDocument(Funnel));

router.get("/deals", listDeals);
router.post("/deals", createDeal);
router.get("/deals/:id", getDeal);
router.patch("/deals/:id", updateDeal);
router.delete("/deals/:id", deleteDeal);
router.patch("/deals/:id/stage", updateDealStage);
router.post("/deals/:id/notes", addDealNote);
router.post("/deals/:id/files", addDealFile);
router.delete("/deals/:id/files/:fileRef", removeDealFile);
router.get("/deals/:id/form-responses", listDealFormResponses);
router.post("/deals/:id/form-invites", createDealFormInvite);
router.get("/deals/:id/dossier", getDealDossier);
router.patch("/deals/:id/dossier", updateDealDossier);
router.post("/deals/:id/dossier/generate", generateDealDossier);

router.get("/products", listDocuments(Product));
router.post("/products", createDocument(Product));
router.get("/products/:id", getDocument(Product));
router.patch("/products/:id", updateDocument(Product));
router.delete("/products/:id", deleteDocument(Product));

router.get("/transactions", requireAdmin, listTransactions);
router.post("/transactions", requireAdmin, createTransaction);
router.get("/transactions/:id", requireAdmin, getDocument(Transaction));
router.patch("/transactions/:id", requireAdmin, updateDocument(Transaction));
router.delete("/transactions/:id", requireAdmin, deleteDocument(Transaction));

router.get("/finance/categories", requireAdmin, listFinancialCategories);
router.post("/finance/categories", requireAdmin, createFinancialCategory);
router.patch("/finance/categories/:id", requireAdmin, updateFinancialCategory);
router.delete("/finance/categories/:id", requireAdmin, deleteFinancialCategory);
router.get("/finance/dashboard", requireAdmin, getFinanceDashboard);

router.get("/tasks", listTasks);
router.post("/tasks", createTask);
router.patch("/tasks/:id/toggle", toggleTask);
router.patch("/tasks/:id/status", updateTaskStatus);
router.patch("/tasks/:id", updateTask);
router.delete("/tasks/:id", deleteTask);

router.get("/nps/surveys", listDocuments(NPSSurvey));
router.post("/nps/surveys", createDocument(NPSSurvey));
router.get("/nps/surveys/:id", getDocument(NPSSurvey));
router.patch("/nps/surveys/:id", updateDocument(NPSSurvey));
router.delete("/nps/surveys/:id", deleteDocument(NPSSurvey));

router.post("/nps/invites", createNpsInvite);
router.get("/nps", listNpsRatings);
router.get("/nps/:id", getDocument(NPSRating));
router.delete("/nps/:id", deleteDocument(NPSRating));

router.get("/forms", listForms);
router.post("/forms", createForm);
router.get("/forms/:id", getForm);
router.patch("/forms/:id", updateForm);
router.delete("/forms/:id", deleteDocument(Form));

router.get("/labels", listDocuments(Label));
router.post("/labels", createDocument(Label));
router.get("/labels/:id", getDocument(Label));
router.patch("/labels/:id", updateDocument(Label));
router.delete("/labels/:id", deleteDocument(Label));

router.get("/note-groups", listNoteGroups);
router.post("/note-groups", createNoteGroup);
router.patch("/note-groups/:id", updateNoteGroup);
router.delete("/note-groups/:id", deleteNoteGroup);

router.get("/notes", listNotes);
router.post("/notes", createNote);
router.get("/notes/:id", getNote);
router.patch("/notes/:id", updateNote);
router.delete("/notes/:id", deleteNote);
router.post("/notes/:id/share", shareNote);
router.delete("/notes/:id/share/:userId", unshareNote);

router.get("/integrations/google/status", requireAdmin, getGoogleStatus);
router.get("/integrations/google/connect", requireAdmin, getGoogleConnectUrl);
router.post("/integrations/google/disconnect", requireAdmin, disconnectGoogle);

export default router;
