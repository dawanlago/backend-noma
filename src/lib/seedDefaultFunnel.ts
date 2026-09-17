import Funnel from "../models/Funnel";

export async function seedDefaultFunnel() {
  const existing = await Funnel.findOne();
  if (existing) return existing;

  const funnel = await Funnel.create({
    name: "Funil Comercial",
    stages: [
      { name: "LEAD", order: 1, type: "general" },
      { name: "QUALIFICADO", order: 2, type: "general" },
      { name: "AGENDAMENTO", order: 3, type: "agenda" },
      { name: "PROPOSTA", order: 4, type: "general" },
      { name: "FECHAMENTO", order: 5, type: "closure" },
    ],
  });

  console.log(`Default funnel created: ${funnel.name}`);
  return funnel;
}
