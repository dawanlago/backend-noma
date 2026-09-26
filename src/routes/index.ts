import { Router } from "express";
import { Label, Product, User } from "../models";
import { getHealth } from "../controllers/health.controller";
import { login, me } from "../controllers/auth.controller";
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../controllers/crud.controller";
import { getDashboard } from "../controllers/dashboard.controller";
import { createUser, updateUser } from "../controllers/user.controller";
import {
  createEntry,
  deleteEntry,
  createInstallments,
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
import { readSettings, updateSettings } from "../controllers/settings.controller";
import { createOption, deleteOption, listOptions, reorderOptions, updateOption } from "../controllers/option.controller";
import {
  createCustomField,
  deleteCustomField,
  listCustomFields,
  updateCustomField,
} from "../controllers/customField.controller";
import { createFunnel, deleteFunnel, listFunnels, updateFunnel } from "../controllers/funnel.controller";
import {
  addComment,
  createLead,
  deleteComment,
  deleteLead,
  getLead,
  listLeads,
  setLeadStatus,
  updateComment,
  updateLead,
} from "../controllers/lead.controller";
import { createTask, deleteTask, listTasks, updateTask } from "../controllers/task.controller";
import {
  createGroup,
  createNote,
  deleteGroup,
  deleteNote,
  listGroups,
  listNotes,
  moveNote,
  shareNote,
  unshareNote,
  updateGroup,
  updateNote,
} from "../controllers/note.controller";
import {
  createForm,
  deleteForm,
  deleteResponse,
  getForm,
  createLeadInvite,
  getInviteByCode,
  getPublicForm,
  listForms,
  listLeadInvites,
  submitInviteByCode,
  listResponses,
  submitPublicForm,
  updateForm,
} from "../controllers/form.controller";
import { deleteFile, listFiles, registerFile, updateFile } from "../controllers/file.controller";
import { signUpload } from "../controllers/upload.controller";
import {
  createContractTemplate,
  deleteContractTemplate,
  listContractTemplates,
  updateContractTemplate,
} from "../controllers/contractTemplate.controller";
import {
  createCompany,
  createContact,
  deleteCompany,
  deleteContact,
  getCompany,
  getCompanyProfile,
  findContactsByPhone,
  getContact,
  getContactProfile,
  listCompanies,
  listContacts,
  updateCompany,
  updateContact,
} from "../controllers/base.controller";
import {
  createInvite as createNpsInvite,
  createSurvey,
  deleteRating,
  deleteSurvey,
  getPublicInvite,
  listRatings,
  listSurveys,
  respondPublicInvite,
  updateSurvey,
} from "../controllers/nps.controller";
import { requireAdmin, requireAuth, requireModule } from "../middlewares/auth";

const router = Router();

router.get("/health", getHealth);
router.post("/auth/login", login);
router.get("/auth/me", requireAuth, me);

// Formulários públicos (link enviado ao cliente), sem login.
router.get("/public/forms/:publicId", getPublicForm);
router.post("/public/forms/:publicId/responses", submitPublicForm);
router.get("/public/form-invites/:code", getInviteByCode);
router.post("/public/form-invites/:code", submitInviteByCode);
router.get("/public/nps/:token", getPublicInvite);
router.post("/public/nps/:token", respondPublicInvite);

router.use(requireAuth);

const settingsAccess = requireModule("configuracoes");
const baseWrite = requireModule("base", "crm", "financeiro", "formularios");

router.get("/dashboard", getDashboard);

router.get("/settings", readSettings);
router.patch("/settings", settingsAccess, updateSettings);

router.get("/options", listOptions);
// Qualquer usuário cadastra uma opção pelo atalho dos formulários; editar e excluir fica nas configurações.
router.post("/options", createOption);
router.put("/options/reorder", settingsAccess, reorderOptions);
router.patch("/options/:id", settingsAccess, updateOption);
router.delete("/options/:id", settingsAccess, deleteOption);

router.get("/custom-fields", listCustomFields);
router.post("/custom-fields", settingsAccess, createCustomField);
router.patch("/custom-fields/:id", settingsAccess, updateCustomField);
router.delete("/custom-fields/:id", settingsAccess, deleteCustomField);

router.get("/users", listDocuments(User));
router.post("/users", requireAdmin, createUser);
router.get("/users/:id", getDocument(User));
router.patch("/users/:id", requireAdmin, updateUser);
router.delete("/users/:id", requireAdmin, deleteDocument(User));

router.get("/companies", listCompanies);
router.post("/companies", baseWrite, createCompany);
router.get("/companies/:id", getCompany);
router.get("/companies/:id/profile", getCompanyProfile);
router.patch("/companies/:id", baseWrite, updateCompany);
router.delete("/companies/:id", requireModule("base"), deleteCompany);

router.get("/contacts", listContacts);
router.post("/contacts", baseWrite, createContact);
router.get("/contacts/by-phone", findContactsByPhone);
router.get("/contacts/:id", getContact);
router.get("/contacts/:id/profile", getContactProfile);
router.patch("/contacts/:id", baseWrite, updateContact);
router.delete("/contacts/:id", requireModule("base"), deleteContact);

router.get("/products", listDocuments(Product));
router.post("/products", requireModule("produtos", "crm"), createDocument(Product));
router.get("/products/:id", getDocument(Product));
router.patch("/products/:id", requireModule("produtos"), updateDocument(Product));
router.delete("/products/:id", requireModule("produtos"), deleteDocument(Product));

router.get("/labels", listDocuments(Label));
router.post("/labels", settingsAccess, createDocument(Label));
router.get("/labels/:id", getDocument(Label));
router.patch("/labels/:id", settingsAccess, updateDocument(Label));
router.delete("/labels/:id", settingsAccess, deleteDocument(Label));

router.get("/funnels", listFunnels);
router.post("/funnels", settingsAccess, createFunnel);
router.patch("/funnels/:id", settingsAccess, updateFunnel);
router.delete("/funnels/:id", settingsAccess, deleteFunnel);

const crmAccess = requireModule("crm");
router.get("/leads", requireModule("crm", "financeiro", "base"), listLeads);
router.post("/leads", crmAccess, createLead);
router.get("/leads/:id", requireModule("crm", "financeiro", "base"), getLead);
router.patch("/leads/:id", crmAccess, updateLead);
router.delete("/leads/:id", crmAccess, deleteLead);
router.post("/leads/:id/status", crmAccess, setLeadStatus);
router.post("/leads/:id/comments", crmAccess, addComment);
router.get("/leads/:id/form-invites", crmAccess, listLeadInvites);
router.post("/leads/:id/form-invites", crmAccess, createLeadInvite);
router.patch("/leads/:id/comments/:commentId", requireAdmin, updateComment);
router.delete("/leads/:id/comments/:commentId", requireAdmin, deleteComment);

router.get("/tasks", listTasks);
router.post("/tasks", createTask);
router.patch("/tasks/:id", updateTask);
router.delete("/tasks/:id", deleteTask);

const notesAccess = requireModule("anotacoes");
router.get("/notes", notesAccess, listNotes);
router.post("/notes", notesAccess, createNote);
router.patch("/notes/:id", notesAccess, updateNote);
router.delete("/notes/:id", notesAccess, deleteNote);
router.put("/notes/:id/group", notesAccess, moveNote);
router.post("/notes/:id/share", notesAccess, shareNote);
router.delete("/notes/:id/share/:userId", notesAccess, unshareNote);
router.get("/note-groups", notesAccess, listGroups);
router.post("/note-groups", notesAccess, createGroup);
router.patch("/note-groups/:id", notesAccess, updateGroup);
router.delete("/note-groups/:id", notesAccess, deleteGroup);

const formsAccess = requireModule("formularios");
// A lista também serve para escolher o formulário a enviar na negociação.
router.get("/forms", requireModule("formularios", "crm"), listForms);
router.post("/forms", formsAccess, createForm);
router.get("/forms/:id", formsAccess, getForm);
router.patch("/forms/:id", formsAccess, updateForm);
router.delete("/forms/:id", formsAccess, deleteForm);
router.get("/forms/:id/responses", formsAccess, listResponses);
router.delete("/forms/:id/responses/:responseId", formsAccess, deleteResponse);

const npsAccess = requireModule("nps");
router.get("/nps/surveys", requireModule("nps", "crm", "base"), listSurveys);
router.post("/nps/surveys", npsAccess, createSurvey);
router.patch("/nps/surveys/:id", npsAccess, updateSurvey);
router.delete("/nps/surveys/:id", npsAccess, deleteSurvey);
router.post("/nps/invites", requireModule("nps", "crm", "base"), createNpsInvite);
router.get("/nps/ratings", requireModule("nps", "crm", "base"), listRatings);
router.delete("/nps/ratings/:id", npsAccess, deleteRating);

const financeAccess = requireModule("financeiro");
router.get("/finance/entries", financeAccess, listEntries);
router.post("/finance/entries", financeAccess, createEntry);
router.post("/finance/installments", financeAccess, createInstallments);
router.patch("/finance/entries/:id", financeAccess, updateEntry);
router.delete("/finance/entries/:id", financeAccess, deleteEntry);
router.get("/finance/summary", financeAccess, getYearSummary);
router.put("/finance/goals/:month", financeAccess, setGoal);

router.get("/tools/:tool/documents", listToolDocuments);
router.post("/tools/:tool/documents", createToolDocument);
router.get("/tools/:tool/documents/:id", getToolDocument);
router.patch("/tools/:tool/documents/:id", updateToolDocument);
router.delete("/tools/:tool/documents/:id", deleteToolDocument);
router.post("/tools/:tool/documents/:id/duplicate", duplicateToolDocument);

const contractsAccess = requireModule("contratos");
router.get("/contract-templates", requireModule("contratos", "configuracoes"), listContractTemplates);
router.post("/contract-templates", settingsAccess, createContractTemplate);
router.patch("/contract-templates/:id", settingsAccess, updateContractTemplate);
router.delete("/contract-templates/:id", settingsAccess, deleteContractTemplate);

router.post("/uploads/sign", signUpload);
router.get("/files", contractsAccess, listFiles);
router.post("/files", contractsAccess, registerFile);
router.patch("/files/:id", contractsAccess, updateFile);
router.delete("/files/:id", contractsAccess, deleteFile);


export default router;
