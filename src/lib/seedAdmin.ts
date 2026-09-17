import User from "../models/User";

const ADMIN_EMAIL = "lainovais@nomacria.com";
const ADMIN_PASSWORD = "admin@123";
const ADMIN_NAME = "Lai";

export async function seedAdminUser() {
  const existing = await User.findOne({ email: ADMIN_EMAIL }).select("+password");

  if (existing) {
    existing.name = ADMIN_NAME;
    existing.role = "admin";
    existing.isActive = true;
    existing.password = ADMIN_PASSWORD;
    await existing.save();
    console.log(`Admin user updated: ${ADMIN_EMAIL}`);
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
