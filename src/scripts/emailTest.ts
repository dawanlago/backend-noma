/**
 * Teste do envio de e-mail com o SMTP do .env:
 *   npm run email:test -- destino@exemplo.com
 */
import { env } from "../config/env";
import { sendMail, testMail } from "../lib/email";

async function main() {
  const to = process.argv[2] || env.smtp?.user;
  if (!env.smtp) {
    console.error("SMTP não configurado: preencha SMTP_HOST, SMTP_USER e SMTP_PASS no .env.");
    process.exit(1);
  }
  if (!to) {
    console.error("Informe o destino: npm run email:test -- destino@exemplo.com");
    process.exit(1);
  }
  console.log(`Enviando de ${env.smtp.from} para ${to} via ${env.smtp.host}:${env.smtp.port}...`);
  const result = await sendMail(testMail(to));
  console.log("Enviado!", result);
}

main().catch((error: Error & { code?: string; responseCode?: number }) => {
  console.error("Falhou:", error.responseCode || error.code || "", error.message);
  if (error.responseCode === 535 || error.code === "EAUTH") {
    console.error("O Google recusou o login. Use uma senha de app (myaccount.google.com/apppasswords), não a senha da conta.");
  }
  process.exit(1);
});
