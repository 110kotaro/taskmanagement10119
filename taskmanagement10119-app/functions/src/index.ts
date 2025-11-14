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
// maxInstances: 1を設定して、同時実行インスタンス数を1つに制限（重複実行を防ぐ）
export const checkReminders = functions
  .runWith({ maxInstances: 1 })
  .pubsub
  .schedule("every 1 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    console.log(`[checkReminders] Function execution started at ${new Date().toISOString()}`);
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
        type TaskType = {
          id: string;
          status?: string;
          assigneeId?: string;
          teamId?: string;
          creatorId?: string;
          reminders?: Array<{
            id: string;
            sent?: boolean;
            scheduledAt?: admin.firestore.Timestamp;
            type?: string;
            amount?: number;
            unit?: "minute" | "hour" | "day";
            [key: string]: unknown;
          }>;
          startDate?: admin.firestore.Timestamp;
          endDate?: admin.firestore.Timestamp;
          title?: string;
          projectId?: string;
          [key: string]: unknown;
        };

        const userTasks: TaskType[] = tasksSnapshot.docs
          .map((doc) => ({id: doc.id, ...doc.data()} as TaskType))
          .filter((task: TaskType) => {
            // タスクが完了している場合はスキップ
            if (task.status === "completed") {
              return false;
            }
            // 担当者が自分のタスク
            if (task.assigneeId === userId) {
              return true;
            }
            // チームタスクで担当者未割当で作成者が自分のタスク
            if (task.teamId && (!task.assigneeId || task.assigneeId === "") && task.creatorId === userId) {
              return true;
            }
            return false;
          });

        for (const task of userTasks) {
          const taskId = task.id;

          // リマインダーはタスク内の配列として保存されている
          const reminders = (task.reminders || []) as Array<{
            id: string;
            sent?: boolean;
            scheduledAt?: admin.firestore.Timestamp;
            type?: string;
            amount?: number;
            unit?: string;
            [key: string]: unknown;
          }>;

          for (const reminder of reminders) {
            // reminder.sentのチェックはトランザクション内で行うため、ここでは削除
            // これにより、複数のトランザクションが同時に開始されることを防ぐ
            
            console.log(
              `[checkReminders] Processing reminder: userId=${userId}, taskId=${taskId}, reminderId=${reminder.id}, sent=${reminder.sent}`
            );

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
              if (!task.startDate || !task.endDate) {
                continue;
              }
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
              if (!reminder.unit || (reminder.unit !== "minute" && reminder.unit !== "hour" && reminder.unit !== "day")) {
                continue;
              }
              const calculatedTime = calculateReminderTime(
                baseDate,
                reminder.amount || 0,
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
              const taskTitle = (task.title || "タスク") as string;
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
              
              // 通知レコード作成条件：お知らせまたはWebPushのどちらかが有効なら作成
              // WebPushのみ通知の場合でも、webPushSentフラグを管理するために通知レコードが必要
              const shouldCreateNotificationRecord = shouldCreateNotification || shouldSendReminderWebPush;

              // 既存の通知チェックはトランザクション内で行うため、ここでは削除
              // これにより、複数のトランザクションが同時に開始されることを防ぐ
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              
              // 通知レコードのドキュメントIDをreminderIdベースで生成（重複防止）
              // トランザクション外でも使用するため、ここで定義
              const year = today.getFullYear();
              const month = String(today.getMonth() + 1).padStart(2, '0');
              const day = String(today.getDate()).padStart(2, '0');
              const todayStr = `${year}-${month}-${day}`;
              const notificationId = `${userId}_${taskId}_${reminder.id}_${todayStr}`;
              const notificationRef = db.collection("notifications").doc(notificationId);

              // トランザクションで通知レコード作成とreminder.sentの更新を同時に行う
              console.log(
                `[checkReminders] Starting transaction: userId=${userId}, taskId=${taskId}, reminderId=${reminder.id}`
              );
              let notificationCreated = false;
              let webPushUpdateNeeded = false; // WebPush送信が必要かどうか（トランザクション内で設定）
              try {
                await db.runTransaction(async (transaction) => {
                  const taskRef = db.collection("tasks").doc(taskId);
                  const taskDoc = await transaction.get(taskRef);
                  
                  if (!taskDoc.exists) {
                    throw new Error(`Task ${taskId} does not exist`);
                  }

                  const taskData = taskDoc.data();
                  const currentReminders = (taskData?.reminders || []) as Array<{
                    id: string;
                    sent?: boolean;
                    [key: string]: unknown;
                  }>;

                  // 現在のreminderの状態を確認
                  const currentReminder = currentReminders.find((r) => r.id === reminder.id);
                  if (currentReminder?.sent) {
                    // 既に送信済みの場合は何もしない
                    console.log(
                      `[checkReminders] Reminder already sent (transaction check) (ユーザー: ${userId}, タスク: ${taskId}, リマインダーID: ${reminder.id})`
                    );
                    return;
                  }

                  // 固定IDでの存在確認を最初に実行（reminder.sentの更新より前）
                  // トランザクション内で存在確認
                  const notificationDoc = await transaction.get(notificationRef);
                  
                  if (notificationDoc.exists) {
                    // 既に存在する場合は、webPushSentフラグをチェック
                    const existingWebPushSent = notificationDoc.data()?.webPushSent === true;
                    
                    // webPushSentがfalseで、WebPush送信が必要な場合のみ、trueに更新（WebPush送信の権利を取得）
                    if (!existingWebPushSent && shouldSendReminderWebPush) {
                      transaction.update(notificationRef, {
                        webPushSent: true,
                      });
                      // トランザクションが成功した場合、トランザクション外でWebPushを送信する
                      // webPushUpdateNeededフラグを設定して、トランザクション外でWebPush送信を実行
                      webPushUpdateNeeded = true;
                    }
                    
                    console.log(
                      `[checkReminders] Notification already exists (transaction check) (ユーザー: ${userId}, タスク: ${taskId}, リマインダーID: ${reminder.id}, webPushSent: ${existingWebPushSent})`
                    );
                    // reminder.sentをtrueにマーク（次回のチェックでスキップされるように）
                    const updatedReminders = currentReminders.map((r) => {
                      if (r.id === reminder.id) {
                        // sentAtを明示的に削除してから新しい値を設定
                        const {sentAt, ...rest} = r;
                        return {
                          ...rest,
                          sent: true,
                          sentAt: admin.firestore.Timestamp.now(),
                        };
                      }
                      // 他のリマインダーは、sentAtがTimestampインスタンスの場合は保持、それ以外は削除
                      if (r.sentAt && r.sentAt instanceof admin.firestore.Timestamp) {
                        // Timestampインスタンスの場合は保持
                        return r;
                      }
                      // Timestampインスタンスでない場合は削除（FieldValue.serverTimestamp()などを除去）
                      const {sentAt, ...rest} = r;
                      return rest;
                    });
                    transaction.update(taskRef, {
                      reminders: updatedReminders,
                    });
                    
                    return;
                  }

                  // リマインダーを送信済みにマーク
                  const updatedReminders = currentReminders.map((r) => {
                    if (r.id === reminder.id) {
                      // sentAtを明示的に削除してから新しい値を設定
                      const {sentAt, ...rest} = r;
                      return {
                        ...rest,
                        sent: true,
                        sentAt: admin.firestore.Timestamp.now(),
                      };
                    }
                    // 他のリマインダーは、sentAtがTimestampインスタンスの場合は保持、それ以外は削除
                    if (r.sentAt && r.sentAt instanceof admin.firestore.Timestamp) {
                      // Timestampインスタンスの場合は保持
                      return r;
                    }
                    // Timestampインスタンスでない場合は削除（FieldValue.serverTimestamp()などを除去）
                    const {sentAt, ...rest} = r;
                    return rest;
                  });

                  // タスクを更新（reminder.sentをtrueに）
                  transaction.update(taskRef, {
                    reminders: updatedReminders,
                  });

                  // Firestoreに通知レコードを作成（お知らせまたはWebPushのどちらかが有効な場合）
                  if (shouldCreateNotificationRecord) {
                    // transaction.create()を使用（存在する場合はエラーになるため、重複を防げる）
                    // トランザクション内での存在確認で既にチェックしているが、
                    // 複数のトランザクションが同時に実行された場合の最終的な防御として使用
                    console.log(
                      `[checkReminders] Attempting to create notification: userId=${userId}, taskId=${taskId}, reminderId=${reminder.id}, notificationId=${notificationId}`
                    );
                    
                    // 新規作成時はwebPushSentを設定
                    // WebPush送信が必要な場合はtrueに設定（トランザクション内でアトミックに更新）
                    // これにより、複数のインスタンスが同時に実行されても、1つだけがWebPush送信権を取得できる
                    transaction.create(notificationRef, {
                      userId: userId,
                      type: "task_reminder",
                      title: "タスクリマインダー",
                      message: message,
                      taskId: taskId,
                      projectId: (task.projectId || null) as string | null,
                      reminderId: reminder.id,
                      isRead: false,
                      webPushSent: shouldSendReminderWebPush, // WebPush送信が必要な場合はtrueに設定
                      createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    notificationCreated = true;
                    // WebPush送信が必要な場合、トランザクション外でWebPushを送信する
                    if (shouldSendReminderWebPush) {
                      webPushUpdateNeeded = true;
                    }
                    console.log(
                      `[checkReminders] Reminder notification created (transaction) for user ${userId} for task ${taskId} (reminderId: ${reminder.id}, notificationId: ${notificationId})`
                    );
                  } else {
                    console.log(
                      `[checkReminders] Notification record skipped for user ${userId} (settings disabled)`
                    );
                  }
                });
              } catch (error: unknown) {
                // transaction.create()が既に存在するドキュメントに対して実行された場合、
                // トランザクション全体がロールバックされる
                // これは正常な動作で、重複を防ぐためのもの
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (errorMessage.includes("already exists") || errorMessage.includes("ALREADY_EXISTS")) {
                  console.log(
                    `[checkReminders] Notification already exists (transaction rollback) (ユーザー: ${userId}, タスク: ${taskId}, リマインダーID: ${reminder.id})`
                  );
                  // エラーを無視（重複を防ぐための正常な動作）
                  notificationCreated = false;
                } else {
                  // その他のエラーは再スロー
                  console.error(
                    `[checkReminders] Transaction error (not already exists): userId=${userId}, taskId=${taskId}, reminderId=${reminder.id}`,
                    error
                  );
                  throw error;
                }
              }

              console.log(
                `[checkReminders] Transaction completed: userId=${userId}, taskId=${taskId}, reminderId=${reminder.id}, notificationCreated=${notificationCreated}`
              );

              // トランザクション完了後、WebPush通知を送信（設定が有効な場合のみ）
              // トランザクション内でwebPushSentフラグをtrueに更新した場合のみ送信
              // トランザクション外でwebPushSentフラグを再確認して、重複送信を防ぐ
              if (shouldSendReminderWebPush && webPushUpdateNeeded) {
                // トランザクション外でwebPushSentフラグを再確認
                const notificationDoc = await db.collection("notifications").doc(notificationId).get();
                const webPushSent = notificationDoc.exists 
                  ? (notificationDoc.data()?.webPushSent === true)
                  : false;
                
                if (webPushSent) {
                  console.log(
                    `[checkReminders] WebPush reminder already sent (duplicate check) for user ${userId} for task ${taskId} (reminderId: ${reminder.id})`
                  );
                } else {
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
                      `[checkReminders] WebPush reminder sent to user ${userId} for task ${taskId} (reminderId: ${reminder.id})`
                    );
                  } catch (error) {
                    console.error(
                      `[checkReminders] Error sending WebPush reminder to user ${userId}:`,
                      error
                    );
                    // エラーが発生した場合、webPushSentフラグをfalseに戻す（再送信可能にする）
                    // ただし、これはオプションで、エラーが発生してもフラグはtrueのままにしておくことも可能
                  }
                }
              } else if (shouldSendReminderWebPush && !webPushUpdateNeeded) {
                console.log(
                  `[checkReminders] WebPush reminder skipped for user ${userId} (already sent or webPushUpdateNeeded is false)`
                );
              } else {
                console.log(
                  `[checkReminders] WebPush reminder skipped for user ${userId} (settings disabled)`
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
