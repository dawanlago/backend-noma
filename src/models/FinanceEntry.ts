import { Schema, models, model, type Document, type Model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenant";
import type { FinanceStatus, TransactionType } from "../types";

export interface IFinanceEntry extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  type: TransactionType;
  description: string;
  client: string;
  category: string;
  value: number;
  date: string; // YYYY-MM-DD, sem fuso horário
  status: FinanceStatus;
  payment: string;
  /** Caixa (ex.: Noma, Brava): separa financeiros diferentes. */
  cashbox: string;
  /** Banco/conta de onde saiu ou para onde entrou. */
  bank: string;
  notes: string;
  /** Data em que foi de fato recebida/paga (YYYY-MM-DD); `date` é o vencimento. */
  paidAt?: string;
  /** Juros/multa de uma entrada recebida depois do vencimento (somam no recebido). */
  lateCharge?: { days: number; fee: number; interest: number; total: number };
  /** Atraso perdoado: recebida depois do vencimento sem cobrar juros/multa. */
  lateChargeWaived: boolean;
  /** Parcela de uma venda dividida (ex.: 2 de 3). */
  installment?: { number: number; total: number };
  recurringId?: Types.ObjectId;
  /** Vínculos opcionais com a negociação e o cliente da base. */
  leadId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  companyId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FinanceEntrySchema = new Schema<IFinanceEntry>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["income", "expense"], required: true },
    description: { type: String, required: true, trim: true },
    client: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "Outro" },
    value: { type: Number, required: true, min: 0 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, enum: ["received", "pending", "paid", "planned"], required: true },
    payment: { type: String, trim: true, default: "Pix" },
    cashbox: { type: String, trim: true, default: "" },
    bank: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    paidAt: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    lateCharge: {
      type: new Schema(
        { days: { type: Number, min: 0 }, fee: { type: Number, min: 0 }, interest: { type: Number, min: 0 }, total: { type: Number, min: 0 } },
        { _id: false },
      ),
      default: undefined,
    },
    lateChargeWaived: { type: Boolean, default: false },
    installment: {
      type: new Schema({ number: { type: Number, min: 1 }, total: { type: Number, min: 1 } }, { _id: false }),
      default: undefined,
    },
    recurringId: { type: Schema.Types.ObjectId, ref: "RecurringExpense" },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact" },
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
  },
  { timestamps: true },
);

FinanceEntrySchema.index({ ownerId: 1, date: 1 });
FinanceEntrySchema.index({ recurringId: 1, date: 1 });
FinanceEntrySchema.index({ leadId: 1, date: 1 });

FinanceEntrySchema.plugin(tenantPlugin);

const FinanceEntry: Model<IFinanceEntry> =
  models.FinanceEntry || model<IFinanceEntry>("FinanceEntry", FinanceEntrySchema);

export default FinanceEntry;
