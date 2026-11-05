const logger = require('firebase-functions/logger');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

const ACTIVE_STATUS = 'active';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStatus(value) {
  return String(value || ACTIVE_STATUS).trim().toLowerCase();
}

function authDisabledForStatus(status) {
  return normalizeStatus(status) !== ACTIVE_STATUS;
}

exports.syncUserAuthDisabledState = onDocumentWritten(
  {
    document: 'users/{email}',
    region: 'us-central1',
  },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;

    if (!after) return;

    const beforeStatus = normalizeStatus(before?.status);
    const eventStatus = normalizeStatus(after.status);
    if (before && beforeStatus === eventStatus) return;

    const liveSnap = await admin.firestore().collection('users').doc(event.params.email).get();
    if (!liveSnap.exists) {
      logger.info('Skipping Auth sync because user profile no longer exists', {
        documentEmail: event.params.email,
      });
      return;
    }

    const liveData = liveSnap.data() || {};
    const email = normalizeEmail(liveData.email || event.params.email);
    if (!email) {
      logger.warn('Cannot sync Auth state without email', { documentEmail: event.params.email });
      return;
    }

    const currentStatus = normalizeStatus(liveData.status);
    const nextDisabled = authDisabledForStatus(currentStatus);

    try {
      const authUser = await admin.auth().getUserByEmail(email);

      if (authUser.disabled !== nextDisabled) {
        await admin.auth().updateUser(authUser.uid, { disabled: nextDisabled });
      }

      if (nextDisabled) {
        await admin.auth().revokeRefreshTokens(authUser.uid);
      }

      logger.info('Synced user Auth disabled state', {
        email,
        uid: authUser.uid,
        status: currentStatus,
        disabled: nextDisabled,
        tokensRevoked: nextDisabled,
      });
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        logger.warn('Cannot sync Auth state because Auth user does not exist', {
          email,
          status: currentStatus,
        });
        return;
      }

      logger.error('Failed to sync user Auth disabled state', {
        email,
        status: currentStatus,
        error,
      });
      throw error;
    }
  }
);
