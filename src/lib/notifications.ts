import User from "../models/User";
import Notification from "../models/Notification";
import type { NotificationType } from "../types";
import { sendMail } from "./email";

export async function notifyUser(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  dealId?: string;
  taskId?: string;
  email?: boolean;
}) {
  const notification = await Notification.create({
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    dealId: params.dealId,
    taskId: params.taskId,
  });

  if (params.email !== false) {
    const user = await User.findById(params.userId);
    if (user?.email) {
      await sendMail({
        to: user.email,
        subject: params.title,
        text: params.body,
      }).catch((error) => {
        console.log("[email:notification-failed]", error instanceof Error ? error.message : error);
      });
    }
  }

  return notification;
}
