import User from "../models/User";

const ADMIN_EMAIL = "lainovais@nomacria.com";
const ADMIN_PASSWORD = "admin@123";
const ADMIN_NAME = "Lai";

/** Garante que o admin existe e está ativo. A senha só é definida na criação: quem troca a senha não a perde a cada reinício. */
export async function seedAdminUser() {
  const existing = await User.findOne({ email: ADMIN_EMAIL });

  if (existing) {
    if (existing.role !== "admin" || !existing.isActive) {
      existing.role = "admin";
      existing.isActive = true;
      await existing.save();
    }
    return;
  }

  await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role: "admin",
    isActive: true,
  });

  console.log(`Admin user created: ${ADMIN_EMAIL}`);
}
