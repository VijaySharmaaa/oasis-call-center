const express    = require('express');
const { ObjectId } = require('mongodb');
const { getDb }  = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['General Inquiry', 'Technical Issue', 'Billing', 'Complaint', 'Service Request', 'Follow Up', 'Others'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const STATUSES   = ['Open', 'In Progress', 'Resolved', 'Closed'];
// Where the ticket came from. Tickets written before this field existed are all
// calls, so 'call' is both the default and the value that matches a missing one.
const SOURCES    = ['call', 'email'];

// Search terms reach a $regex, and an email address is full of regex
// metacharacters — a bare "a.b+c@x.com" would otherwise match far too much.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A trimmed string, or '' for anything that is not one. */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function nextTicketNumber(db) {
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: 'ticket_counter' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return `TKT-${String(result.seq).padStart(4, '0')}`;
}

// POST /api/tickets — create a ticket (from a call or from an email)
router.post('/', async (req, res) => {
  const {
    call_id, email_id, email_subject,
    customer_name, customer_number, customer_email,
    agent_number, agent_name,
    title, description, category, priority, source,
  } = req.body;

  // A call identifies the customer by number, an email by address. Exactly one
  // of the two is guaranteed to be present, never both, so the requirement is
  // "some way to reach the customer" rather than a phone number specifically.
  // Non-string input is treated as absent — a bad body earns a 400, not a 500.
  const number  = text(customer_number) || null;
  const email   = text(customer_email).toLowerCase() || null;
  const subject = text(title);
  if (!number && !email) return res.status(400).json({ error: 'customer_number or customer_email is required' });
  if (!subject)          return res.status(400).json({ error: 'title is required' });

  const db  = await getDb();
  const now = new Date();
  const ticket_number = await nextTicketNumber(db);

  const resolvedSource = SOURCES.includes(source) ? source : (email_id ? 'email' : 'call');

  const ticket = {
    ticket_number,
    source:          resolvedSource,
    call_id:         call_id  || null,
    email_id:        email_id || null,
    email_subject:   email_subject || null,
    customer_name:   customer_name || null,
    customer_number: number,
    customer_email:  email,
    agent_number:    agent_number  || req.user.agent_number || null,
    agent_name:      agent_name    || req.user.name         || null,
    title:           subject,
    description:     description   || '',
    category:        CATEGORIES.includes(category) ? category : 'General Inquiry',
    priority:        PRIORITIES.includes(priority) ? priority : 'Medium',
    status:          'Open',
    created_by_name: req.user.name,
    created_at:      now,
    updated_at:      now,
    timeline: [{
      type:      'created',
      note:      resolvedSource === 'email' ? 'Ticket created from email' : 'Ticket created',
      by_name:   req.user.name,
      by_number: req.user.agent_number || null,
      at:        now,
    }],
  };

  const result = await db.collection('tickets').insertOne(ticket);
  res.status(201).json({ id: result.insertedId.toString(), ...ticket });
});

// GET /api/tickets — list
router.get('/', async (req, res) => {
  const db = await getDb();
  const {
    status, priority, category, agentNumber, customerNumber, customerEmail,
    emailId, callId, source, search, limit = '25', offset = '0', dateFrom, dateTo,
  } = req.query;

  const conditions = [];

  if (status)         conditions.push({ status });
  if (priority)       conditions.push({ priority });
  if (category)       conditions.push({ category });
  if (agentNumber)    conditions.push({ agent_number: agentNumber });
  if (customerNumber) conditions.push({ customer_number: customerNumber });
  if (customerEmail)  conditions.push({ customer_email: customerEmail.toLowerCase() });
  if (emailId)        conditions.push({ email_id: emailId });
  if (callId)         conditions.push({ call_id: callId });

  // Tickets predating the `source` field are calls, hence the $exists arm.
  if (source === 'call')       conditions.push({ $or: [{ source: 'call' }, { source: { $exists: false } }] });
  else if (source === 'email') conditions.push({ source: 'email' });

  if (search) {
    const re = { $regex: escapeRegex(search), $options: 'i' };
    conditions.push({ $or: [
      { ticket_number:   re },
      { customer_name:   re },
      { customer_number: re },
      { customer_email:  re },
      { email_subject:   re },
      { title:           re },
      { agent_name:      re },
    ]});
  }

  if (dateFrom || dateTo) {
    const dc = {};
    if (dateFrom) dc.$gte = new Date(dateFrom);
    if (dateTo)   dc.$lte = new Date(dateTo);
    conditions.push({ created_at: dc });
  }

  const filter = conditions.length ? { $and: conditions } : {};

  const [docs, total] = await Promise.all([
    db.collection('tickets').find(filter, { projection: { timeline: 0 } })
      .sort({ created_at: -1 }).skip(Number(offset)).limit(Number(limit)).toArray(),
    db.collection('tickets').countDocuments(filter),
  ]);

  const tickets = docs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc }));
  res.json({ tickets, total });
});

// GET /api/tickets/:id — single ticket with timeline
router.get('/:id', async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const { _id, ...rest } = doc;
  res.json({ id: _id.toString(), ...rest });
});

// PATCH /api/tickets/:id — update status / priority / fields
router.patch('/:id', async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const { status, priority, title, description, category } = req.body;
  const now      = new Date();
  const updates  = { updated_at: now };
  const entries  = [];

  if (status && status !== doc.status && STATUSES.includes(status)) {
    updates.status = status;
    entries.push({ type: 'status_changed', from: doc.status, to: status,
      note: `Status changed from "${doc.status}" to "${status}"`,
      by_name: req.user.name, by_number: req.user.agent_number || null, at: now });
  }
  if (priority && priority !== doc.priority && PRIORITIES.includes(priority)) {
    updates.priority = priority;
    entries.push({ type: 'priority_changed', from: doc.priority, to: priority,
      note: `Priority changed from "${doc.priority}" to "${priority}"`,
      by_name: req.user.name, by_number: req.user.agent_number || null, at: now });
  }
  if (title)                updates.title       = title;
  if (description !== undefined) updates.description = description;
  if (category && CATEGORIES.includes(category)) updates.category = category;

  const op = { $set: updates };
  if (entries.length) op.$push = { timeline: { $each: entries } };

  await db.collection('tickets').updateOne({ _id: new ObjectId(req.params.id) }, op);
  res.json({ success: true });
});

// POST /api/tickets/:id/note — add a timeline note
router.post('/:id/note', async (req, res) => {
  const db = await getDb();
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'note is required' });

  const doc = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const now   = new Date();
  const entry = { type: 'note', note: note.trim(), by_name: req.user.name, by_number: req.user.agent_number || null, at: now };

  await db.collection('tickets').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $push: { timeline: entry }, $set: { updated_at: now } }
  );
  res.json({ success: true });
});

// DELETE /api/tickets/:id — any authenticated user can delete
router.delete('/:id', async (req, res) => {
  const db     = await getDb();
  const result = await db.collection('tickets').deleteOne({ _id: new ObjectId(req.params.id) });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
