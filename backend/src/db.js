const { MongoClient } = require('mongodb');
const logger = require('./logger');

let dbPromise = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = MongoClient.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    })
      .then(client => {
        client.on('error', (err) => {
          logger.error('[DB] Connection error — will reconnect on next request', { message: err.message });
          dbPromise = null;
        });
        client.on('close', () => {
          logger.warn('[DB] Connection closed — will reconnect on next request');
          dbPromise = null;
        });
        const db = client.db();
        logger.info('[DB] Connected', { database: db.databaseName });
        return Promise.all([
          db.collection('calls').createIndex({ call_id: 1 }, { unique: true }),
          db.collection('call_analysis').createIndex({ call_id: 1 }, { unique: true }),
          db.collection('call_analysis').createIndex({ status: 1, created_at: 1 }),
          db.collection('agents').createIndex({ agent_number: 1 }, { unique: true }),
          db.collection('click2call_pending').createIndex({ initiated_at: 1 }, { expireAfterSeconds: 1800 }),
          db.collection('emails').createIndex({ gmail_id: 1 }, { unique: true }),
          db.collection('emails').createIndex({ received_at: -1 }),
          db.collection('emails').createIndex({ thread_id: 1 }),
          db.collection('emails').createIndex({ from_email: 1 }),
          db.collection('emails').createIndex({ is_unread: 1, received_at: -1 }),
          // The unread pill and filter read both halves of "unread in Gmail and
          // not yet opened here", so the index has to cover read_at too.
          db.collection('emails').createIndex({ is_unread: 1, read_at: 1, received_at: -1 }),
          db.collection('emails').createIndex({ category: 1, received_at: -1 }),
          // Multikey indexes over the tag array — one entry per tag per doc, so
          // a category filter is served whether it hits the primary tag or a
          // secondary one.
          db.collection('emails').createIndex({ 'tags.category': 1, received_at: -1 }),
          db.collection('emails').createIndex({ 'tags.sub_category': 1 }),
          db.collection('calls').createIndex({ 'tags.category': 1, created_at: -1 }),
          db.collection('call_analysis').createIndex({ 'tags.category': 1 }),
          db.collection('email_analysis').createIndex({ gmail_id: 1 }, { unique: true }),
          db.collection('email_analysis').createIndex({ status: 1, created_at: -1 }),
          db.collection('email_analysis').createIndex({ category: 1 }),
          // Tickets are opened from a call or an email detail view, both of
          // which look up "everything already raised for this customer".
          db.collection('tickets').createIndex({ created_at: -1 }),
          db.collection('tickets').createIndex({ customer_number: 1, created_at: -1 }),
          db.collection('tickets').createIndex({ customer_email: 1, created_at: -1 }),
          db.collection('tickets').createIndex({ email_id: 1 }),
        ]).then(() => db);
      })
      .catch(err => {
        logger.error('[DB] Failed to connect', { message: err.message });
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

module.exports = { getDb };
