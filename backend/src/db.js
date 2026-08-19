const { MongoClient } = require('mongodb');
const logger = require('./logger');

let dbPromise = null;

function getDb() {
  if (!dbPromise) {
    // Check before handing the driver an undefined URI. Without this the driver
    // fails with "Cannot read properties of undefined (reading 'startsWith')",
    // repeated by every worker on every retry — a message that says nothing
    // about the real cause, which is always that the container was started
    // without its environment. Not cached: the next call re-reads the env.
    if (!process.env.MONGODB_URI) {
      return Promise.reject(new Error(
        'MONGODB_URI is not set — the container was started without its environment ' +
        '(check docker --env-file / compose env_file / the task definition)'
      ));
    }

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
          // Mail is grouped by correspondent, not by Gmail thread — every
          // message carries the conversation it belongs to, and the chat view
          // reads one conversation's messages in time order.
          db.collection('emails').createIndex({ conversation_id: 1, received_at: 1 }),
          // The Emails tab is a list of conversations sorted by recency, so
          // that pair is the index every page of it is served from.
          db.collection('email_conversations').createIndex({ last_message_at: -1 }),
          db.collection('email_conversations').createIndex({ 'tags.category': 1, last_message_at: -1 }),
          db.collection('email_conversations').createIndex({ category: 1, last_message_at: -1 }),
          db.collection('email_conversations').createIndex({ unread_count: 1, last_message_at: -1 }),
          // The analysis sweep asks exactly this: which conversations have
          // heard something new since the last verdict.
          db.collection('email_conversations').createIndex({ needs_analysis: 1 }),
          db.collection('conversation_analysis').createIndex({ status: 1, created_at: -1 }),
          db.collection('conversation_analysis').createIndex({ category: 1 }),
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
