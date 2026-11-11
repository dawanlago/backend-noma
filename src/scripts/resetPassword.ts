/**
 * Redefine a senha de um usuário direto no banco (ex.: o admin principal esqueceu a senha
 * e o envio de e-mail do "Esqueci a senha" não está configurado):
 *   npm run user:reset-password -- email@exemplo.com "nova senha com 8+ caracteres"
 * Usa o MONGODB_URI do .env. Reativa o usuário, se estiver inativo.
 */
import mongoose from "mongoose";
import { connectToDatabase } from "../config/db";
import User from "../models/User";

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  const password = String(process.argv[3] || "");
  if (!email || password.length < 8) {
    console.error('Uso: npm run user:reset-password -- email@exemplo.com "nova senha (mínimo 8 caracteres)"');
    process.exit(1);
  }
  await connectToDatabase();
  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    console.error(`Nenhum usuário com o e-mail ${email}.`);
    process.exit(1);
  }
  user.password = password;
  user.isActive = true;
  user.resetTokenHash = undefined;
  user.resetTokenExpiresAt = undefined;
  await user.save();
  console.log(`Senha de ${user.name} (${email}) redefinida.`);
}

main()
  .catch((error: Error) => {
    console.error("Falhou:", error.message);
    process.exitCode = 1;
  })
  .finally(() => void mongoose.disconnect());
