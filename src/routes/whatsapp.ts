import { Router } from "express";
import {
  createChatLead,
  getStatus,
  listChats,
  listMessages,
  markChatRead,
  sendToChat,
  sendToPhone,
  zapiWebhook,
} from "../controllers/whatsapp.controller";
import { integrationFromHook } from "../lib/integrations";
import { requireModule } from "../middlewares/auth";

/** Rotas públicas (webhooks / acesso por token), montadas antes do login. */
export const publicRouter = Router();

// Webhook da Z-API ("Ao receber", "Ao enviar" e "Status da mensagem" apontam para a mesma URL).
publicRouter.post("/public/webhooks/zapi/:hookKey", integrationFromHook("zapi"), zapiWebhook);

/** Rotas internas (usuário logado), montadas depois do login. */
export const privateRouter = Router();

// Caixa de entrada do WhatsApp (módulo CRM).
const crmAccess = requireModule("crm");
privateRouter.get("/whatsapp/status", crmAccess, getStatus);
privateRouter.get("/whatsapp/chats", crmAccess, listChats);
privateRouter.get("/whatsapp/chats/:id/messages", crmAccess, listMessages);
privateRouter.post("/whatsapp/chats/:id/messages", crmAccess, sendToChat);
privateRouter.post("/whatsapp/chats/:id/read", crmAccess, markChatRead);
privateRouter.post("/whatsapp/chats/:id/lead", crmAccess, createChatLead);
privateRouter.post("/whatsapp/send", crmAccess, sendToPhone);
