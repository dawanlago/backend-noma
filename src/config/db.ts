import mongoose from "mongoose";
import { env } from "./env";

export async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  await mongoose.connect(env.mongodbUri);
  console.log(`MongoDB connected: ${mongoose.connection.name}`);

  return mongoose.connection;
}
