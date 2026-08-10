// src/services/notificationService.js
//
// Local notifications (scheduled/immediate reminders on THIS device) work
// fully offline via expo-notifications. Remote notifications — notifying
// a DIFFERENT device, like alerting a merchant that a customer just
// reserved something — are sent by calling Expo's push API directly from
// the client with the recipient's push token. This is a pragmatic
// approach given there's no backend/Cloud Functions yet (same trade-off
// pattern as the base64 image storage workaround). It does mean anyone
// who obtained another user's push token could technically send them a
// notification; acceptable at this app's current trust level, but a real
// backend should own sending once one exists.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Requests permission and returns an Expo push token, or null if denied/unavailable. */
export async function registerForPushNotifications() {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    return token;
  } catch (err) {
    return null;
  }
}

/** Fires immediately on this device — used for "reservation confirmed" etc. */
export async function scheduleLocalNotification(title, body) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch (err) {
    // Non-critical — a notification failing should never break the calling flow.
  }
}

/** Sends a remote push to another device via Expo's push service. */
export async function sendPushNotification(pushToken, title, body, data = {}) {
  if (!pushToken) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken, title, body, data,
      }),
    });
  } catch (err) {
    // Non-critical — a notification failing should never break the calling flow.
  }
}
