/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

admin.initializeApp();

// リマインダーチェック関数（1分ごとに実行）
export const checkReminders = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    try {
      // すべてのユーザーを取得
      const usersSnapshot = await db.collection("users").get();

      for (const userDoc of usersSnapshot.docs) {
        const user = userDoc.data();
        const userId = userDoc.id;
        const fcmToken = user.fcmToken;
        const notificationSettings = user.notificationSettings || {};

        if (!fcmToken) {
          continue; // FCMトークンがない場合はスキップ
        }

        // リマインダーのWebPush通知設定をチェック
        // カテゴリ設定（reminderWebPush）と個別設定（taskReminderWebPush）の両方が有効である必要がある
        const reminderWebPushEnabled = notificationSettings.reminderWebPush !== false;
        const taskReminderWebPushEnabled = notificationSettings.taskReminderWebPush !== false;
        const shouldSendReminderWebPush = reminderWebPushEnabled && taskReminderWebPushEnabled;

        if (!shouldSendReminderWebPush) {
          console.log(
            `[checkReminders] User ${userId} has reminder WebPush notifications disabled`
          );
          // WebPush通知は送信しないが、通知レコードは作成する（アプリ内通知は表示される）
        }

        // ユーザーのタスクを取得（担当者が自分のタスク、またはチームタスクで担当者未割当で作成者が自分のタスク）
        const tasksSnapshot = await db.collection("tasks")
          .where("isDeleted", "==", false)
          .get();

        // フィルタリング: 担当者が自分のタスク、またはチームタスクで担当者未割当で作成者が自分のタスク
        const userTasks = tasksSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((task: any) => {
            // タスクが完了している場合はスキップ
            if (task.status === "completed") {
              return false;
            }
            // 担当者が自分のタスク
            if (task.assigneeId === userId) {
              return true;
            }
            // チームタスクで担当者未割当で作成者が自分のタスク
            if (task.teamId && (!task.assigneeId || task.assigneeId === '') && task.creatorId === userId) {
              return true;
            }
            return false;
          });

        for (const task of userTasks) {
          const taskId = task.id;

          // リマインダーはタスク内の配列として保存されている
          const reminders = task.reminders || [];

          for (const reminder of reminders) {
            // 既に送信済みの場合はスキップ
            if (reminder.sent) {
              continue;
            }

            let shouldNotify = false;

            // カスタムリマインダー（絶対日時）
            if (reminder.scheduledAt) {
              const reminderScheduledAt = reminder.scheduledAt;
              const scheduledTimeMillis = reminderScheduledAt.toMillis();
              const currentTimeMillis = now.toMillis();
              const timeDiff = currentTimeMillis - scheduledTimeMillis;

              // リマインダー時間が過ぎている場合（1分以内の誤差を許容）
              if (timeDiff >= 0 && timeDiff <= 60000) {
                shouldNotify = true;
              }
            } else if (
              reminder.type &&
              reminder.amount !== undefined &&
              reminder.unit
            ) {
              // 相対リマインダー（開始前/期限前）
              const taskStartDate = task.startDate.toDate();
              const taskEndDate = task.endDate.toDate();
              let baseDate: Date;

              if (reminder.type === "before_start") {
                baseDate = taskStartDate;
              } else if (reminder.type === "before_end") {
                baseDate = taskEndDate;
              } else {
                continue;
              }

              // リマインダー時間を計算
              const calculatedTime = calculateReminderTime(
                baseDate,
                reminder.amount,
                reminder.unit
              );

              if (calculatedTime) {
                const calculatedTimeMillis = calculatedTime.getTime();
                const currentTimeMillis = now.toMillis();
                const timeDiff = currentTimeMillis - calculatedTimeMillis;

                // リマインダー時間が過ぎている場合（1分以内の誤差を許容）
                if (timeDiff >= 0 && timeDiff <= 60000) {
                  shouldNotify = true;
                }
              }
            }

            if (shouldNotify) {
              // 通知メッセージを生成
              let message = "";
              const taskTitle = task.title || "タスク";
              if (reminder.type === "before_start") {
                const timeStr = formatReminderTime(reminder);
                message = `タスク「${taskTitle}」が開始予定時刻の${timeStr}前に近づいています`;
              } else if (reminder.type === "before_end") {
                const timeStr = formatReminderTime(reminder);
                message = `タスク「${taskTitle}」が期限の${timeStr}前に近づいています`;
              } else {
                message = `タスク「${taskTitle}」のリマインダーです`;
              }

              // お知らせ欄への通知設定をチェック
              // カテゴリ設定（reminder）と個別設定（taskReminder）の両方が有効である必要がある
              const reminderEnabled = notificationSettings.reminder !== false;
              const taskReminderEnabled = notificationSettings.taskReminder !== false;
              const shouldCreateNotification = reminderEnabled && taskReminderEnabled;

              // WebPush通知を送信（設定が有効な場合のみ）
              if (shouldSendReminderWebPush) {
                const fcmMessage = {
                  notification: {
                    title: "タスクリマインダー",
                    body: message,
                  },
                  data: {
                    taskId: taskId,
                    type: "task_reminder",
                    url: `/task/${taskId}`,
                  },
                  token: fcmToken,
                };

                try {
                  console.log(
                    `[checkReminders] 送信するFCMトークン: ${fcmToken}`
                  );
                  await admin.messaging().send(fcmMessage);
                  console.log(
                    `[checkReminders] WebPush reminder sent to user ${userId} for task ${taskId}`
                  );
                } catch (error) {
                  console.error(
                    `[checkReminders] Error sending WebPush reminder to user ${userId}:`,
                    error
                  );
                }
              } else {
                console.log(
                  `[checkReminders] WebPush reminder skipped for user ${userId} (settings disabled)`
                );
              }

              // リマインダーを送信済みにマーク
              const updatedReminders = reminders.map((r: {
                id: string;
                sent?: boolean;
                sentAt?: admin.firestore.Timestamp;
                [key: string]: unknown;
              }) => {
                if (r.id === reminder.id) {
                  return {
                    ...r,
                    sent: true,
                    sentAt: admin.firestore.FieldValue.serverTimestamp(),
                  };
                }
                return r;
              });

              // タスクを更新
              await db.collection("tasks").doc(taskId).update({
                reminders: updatedReminders,
              });

              // Firestoreに通知レコードを作成（お知らせ欄への通知設定が有効な場合のみ）
              if (shouldCreateNotification) {
                await db.collection("notifications").add({
                  userId: userId,
                  type: "task_reminder",
                  title: "タスクリマインダー",
                  message: message,
                  taskId: taskId,
                  projectId: task.projectId || null,
                  isRead: false,
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                console.log(
                  `[checkReminders] Reminder notification created for user ${userId} for task ${taskId}`
                );
              } else {
                console.log(
                  `[checkReminders] Notification record skipped for user ${userId} (settings disabled)`
                );
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Error checking reminders:", error);
      return null;
    }
  });

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: v1 APIでは、各関数にfunctions.runWith()を使用します
// v1 APIでは、各関数はコンテナごとに1つのリクエストのみを処理できるため、
// これが最大同時リクエスト数になります。

/**
 * リマインダー時間を計算（相対リマインダー用）
 * @param {Date} baseDate - 基準日時
 * @param {number} amount - 数量
 * @param {string} unit - 単位（minute, hour, day）
 * @return {Date | null} 計算されたリマインダー日時
 */
function calculateReminderTime(
  baseDate: Date,
  amount: number,
  unit: "minute" | "hour" | "day"
): Date | null {
  const reminderTime = new Date(baseDate);

  switch (unit) {
  case "minute":
    reminderTime.setMinutes(reminderTime.getMinutes() - amount);
    break;
  case "hour":
    reminderTime.setHours(reminderTime.getHours() - amount);
    break;
  case "day":
    reminderTime.setDate(reminderTime.getDate() - amount);
    break;
  default:
    return null;
  }

  return reminderTime;
}

/**
 * リマインダー時間をフォーマット（通知メッセージ用）
 * @param {Object} reminder - リマインダーオブジェクト
 * @param {number} reminder.amount - 数量
 * @param {string} reminder.unit - 単位
 * @return {string} フォーマットされた時間文字列
 */
function formatReminderTime(reminder: {
  amount?: number;
  unit?: string;
}): string {
  if (!reminder.amount || !reminder.unit) {
    return "";
  }

  const unitMap: {[key: string]: string} = {
    "minute": "分",
    "hour": "時間",
    "day": "日",
  };

  return `${reminder.amount}${unitMap[reminder.unit] || ""}`;
}

/**
 * 通知タイプに基づいてURLを生成
 * @param {Object} notification - 通知オブジェクト
 * @param {string} [notification.taskId] - タスクID
 * @param {string} [notification.projectId] - プロジェクトID
 * @param {string} [notification.teamId] - チームID
 * @return {string} 通知のURL
 */
function getNotificationUrl(notification: {
  taskId?: string;
  projectId?: string;
  teamId?: string;
}): string {
  if (notification.taskId) {
    return `/task/${notification.taskId}`;
  } else if (notification.projectId) {
    return `/project/${notification.projectId}`;
  } else if (notification.teamId) {
    return `/team/${notification.teamId}`;
  }
  return "/notifications";
}

/**
 * 通知作成時にWebPushとメールを送信するFirestoreトリガー
 */
export const onNotificationCreated = functions.firestore
  .document("notifications/{notificationId}")
  .onCreate(async (snap, context) => {
    const notification = snap.data();
    const notificationId = context.params.notificationId;

    console.log(
      `[onNotificationCreated] 通知作成: ${notificationId}`
    );
    console.log(
      "[onNotificationCreated] 通知データ:",
      JSON.stringify(notification)
    );

    try {
      // ユーザー情報を取得
      const userDoc = await admin.firestore()
        .collection("users")
        .doc(notification.userId)
        .get();
      if (!userDoc.exists) {
        console.log(
          `[onNotificationCreated] User ${notification.userId} not found`
        );
        return;
      }

      const user = userDoc.data();
      const userEmail = user?.email;
      const fcmToken = user?.fcmToken;
      const notificationSettings = user?.notificationSettings || {};

      console.log(
        `[onNotificationCreated] ユーザー情報: email=${userEmail}, ` +
        `fcmToken=${fcmToken ? "あり" : "なし"}`
      );

      // WebPush通知の設定を確認
      const notificationType = notification.type || "";
      const checkType = notification.checkType;

      // カテゴリを判定
      let category = "task";
      if (notificationType === "task_created" ||
          notificationType === "task_updated" ||
          notificationType === "task_deleted" ||
          notificationType === "task_restored" ||
          notificationType === "task_completed") {
        category = "task";
      } else if (notificationType === "task_overdue" && checkType) {
        category = "dateCheck";
      } else if (notificationType === "task_overdue" ||
                 notificationType === "task_reminder") {
        category = "reminder";
      } else if (notificationType === "project_created" ||
                 notificationType === "project_updated" ||
                 notificationType === "project_deleted" ||
                 notificationType === "project_restored" ||
                 notificationType === "project_completed") {
        category = "project";
      } else if (notificationType === "team_invitation" ||
                 notificationType === "team_invitation_accepted" ||
                 notificationType === "team_invitation_rejected" ||
                 notificationType === "team_leave" ||
                 notificationType === "team_permission_change" ||
                 notificationType === "team_admin_announcement") {
        category = "team";
      }

      // 個別設定キーを判定
      let settingKey: string | null = null;
      if (notificationType === "task_created") {
        settingKey = "taskCreated";
      } else if (notificationType === "task_updated") {
        settingKey = "taskUpdated";
      } else if (notificationType === "task_deleted") {
        settingKey = "taskDeleted";
      } else if (notificationType === "task_restored") {
        settingKey = "taskRestored";
      } else if (notificationType === "task_completed") {
        settingKey = "taskCompleted";
      } else if (notificationType === "project_created") {
        settingKey = "projectCreated";
      } else if (notificationType === "project_updated") {
        settingKey = "projectUpdated";
      } else if (notificationType === "project_deleted") {
        settingKey = "projectDeleted";
      } else if (notificationType === "project_restored") {
        settingKey = "projectRestored";
      } else if (notificationType === "project_completed") {
        settingKey = "projectCompleted";
      } else if (notificationType === "task_overdue" &&
                 checkType === "startDate") {
        settingKey = "startDateOverdue";
      } else if (notificationType === "task_overdue" &&
                 checkType === "endDate") {
        settingKey = "endDateOverdue";
      } else if (notificationType === "task_overdue") {
        settingKey = "taskOverdue";
      } else if (notificationType === "task_reminder") {
        settingKey = "taskReminder";
      } else if (notificationType === "team_invitation") {
        settingKey = "teamInvitation";
      } else if (notificationType === "team_invitation_accepted") {
        settingKey = "teamInvitationAccepted";
      } else if (notificationType === "team_invitation_rejected") {
        settingKey = "teamInvitationRejected";
      } else if (notificationType === "team_leave") {
        settingKey = "teamLeave";
      } else if (notificationType === "team_permission_change") {
        settingKey = "teamPermissionChange";
      } else if (notificationType === "team_admin_announcement") {
        settingKey = "teamAdminAnnouncement";
      }

      // WebPush設定を確認
      const categoryWebPushKey = `${category}WebPush`;
      const settingWebPushKey = settingKey ? `${settingKey}WebPush` : null;

      // デフォルトはtrue
      const categoryWebPushEnabled =
        notificationSettings[categoryWebPushKey] !== false;
      // デフォルトはtrue
      const settingWebPushEnabled = settingWebPushKey ?
        (notificationSettings[settingWebPushKey] !== false) : true;

      const shouldSendWebPush = categoryWebPushEnabled && settingWebPushEnabled;

      console.log(
        `[onNotificationCreated] WebPush設定: category=${category}, ` +
        `categoryWebPush=${categoryWebPushEnabled}, ` +
        `settingKey=${settingKey || "なし"}, ` +
        `settingWebPush=${settingWebPushEnabled}, ` +
        `shouldSend=${shouldSendWebPush}`
      );

      // WebPush通知を送信
      if (fcmToken && shouldSendWebPush) {
        try {
          const fcmMessage = {
            notification: {
              title: notification.title || "お知らせ",
              body: notification.message || "",
            },
            data: {
              notificationId: notificationId,
              type: notification.type || "",
              taskId: notification.taskId || "",
              projectId: notification.projectId || "",
              teamId: notification.teamId || "",
              url: getNotificationUrl(notification),
            },
            token: fcmToken,
          };

          console.log(
            "[onNotificationCreated] 送信するFCMトークン:",
            fcmToken
          );
          await admin.messaging().send(fcmMessage);
          console.log(
            "[onNotificationCreated] WebPush notification sent to user " +
            `${notification.userId}`
          );
        } catch (error: unknown) {
          console.error(
            "[onNotificationCreated] Error sending WebPush notification:",
            error
          );
        }
      } else {
        if (!fcmToken) {
          console.log(
            "[onNotificationCreated] FCMトークンがないため、WebPush通知をスキップ"
          );
        } else if (!shouldSendWebPush) {
          console.log(
            "[onNotificationCreated] WebPush通知が無効化されているため、スキップ"
          );
        }
      }
    } catch (error: unknown) {
      console.error(
        "[onNotificationCreated] Error processing notification " +
        `${notificationId}:`,
        error
      );
    }
  });

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
