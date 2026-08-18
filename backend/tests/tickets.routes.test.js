/**
 * /api/tickets — creation from both sources, and the filters the two ticket
 * modals rely on.
 *
 * A ticket used to be a call artefact: it required a phone number. Emails
 * identify the customer by address instead, so the contract now is "a number OR
 * an address", and `source` tells the two apart. Everything below is about not
 * breaking the call half while the email half is added.
 *
 * SCOPE: POST / and GET /. The :id routes build an ObjectId from the path, which
 * the in-memory fake has no notion of — covering them would test the fake.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV   = 'test';
process.env.LOG_LEVEL  = 'error';

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

/**
 * Tickets are keyed by _id in Mongo, which the fake cannot mint on insert — so
 * inserted documents are keyed by their ticket number instead, which the
 * counter already guarantees is unique.
 */
const keyFor = (name, doc) => (name === 'tickets' ? (doc._id ?? doc.ticket_number) : doc._id);

/* A call ticket predating the `source` field, one written after it, and one
   raised from an email. */
const SEED_TICKETS = [
  { _id: 'tk-legacy', ticket_number: 'TKT-0001',
    customer_number: '919876543210', customer_name: 'Aasha',
    title: 'Refund not received', category: 'Billing', priority: 'High', status: 'Open',
    agent_number: '1001', agent_name: 'Ravi', created_by_name: 'Ravi',
    created_at: new Date('2026-08-10T10:00:00Z'), updated_at: new Date('2026-08-10T10:00:00Z') },

  { _id: 'tk-call', ticket_number: 'TKT-0002', source: 'call', call_id: 'BZ-1',
    customer_number: '919812345678', customer_name: 'Ravi',
    title: 'OTR edit', category: 'Technical Issue', priority: 'Medium', status: 'Open',
    created_by_name: 'Admin',
    created_at: new Date('2026-08-11T10:00:00Z'), updated_at: new Date('2026-08-11T10:00:00Z') },

  { _id: 'tk-email', ticket_number: 'TKT-0003', source: 'email', email_id: 'm1',
    email_subject: 'Payment debited but form incomplete',
    customer_email: 'aasha@example.com', customer_name: 'Aasha',
    title: 'Payment debited but form incomplete', category: 'Billing', priority: 'Urgent', status: 'Open',
    created_by_name: 'Admin',
    created_at: new Date('2026-08-12T10:00:00Z'), updated_at: new Date('2026-08-12T10:00:00Z') },
];

const adminToken = jwt.sign({ name: 'Admin', role: 'admin' }, 'test-secret');
const agentToken = jwt.sign({ name: 'Ravi Kumar', role: 'agent', agent_number: '1001' }, 'test-secret');

let app;
beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeDb({ tickets: SEED_TICKETS }, keyFor);
  app = express();
  app.use(express.json());
  app.use('/api/tickets', require('../src/routes/tickets'));
});

const get  = (path, token = adminToken) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const post = (body, token = adminToken) => request(app).post('/api/tickets').set('Authorization', `Bearer ${token}`).send(body);

/** The stored document, which is where the created shape is asserted — the fake
 *  cannot mint an _id, so a round-trip through GET /:id is not available. */
const stored = ticketNumber => mockFake.store.tickets.get(ticketNumber);

const numbers = res => res.body.tickets.map(t => t.ticket_number);

describe('auth', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app).get('/api/tickets').expect(401);
    await request(app).post('/api/tickets').send({ title: 'x', customer_number: '1' }).expect(401);
  });
});

describe('POST — from a call', () => {
  it('still stores a call ticket the way it always did', async () => {
    const res = await post({
      call_id: 'BZ-9', customer_number: '919800000009', customer_name: 'Sunita',
      title: 'Callback requested', description: 'wants a call back',
      category: 'Follow Up', priority: 'High',
    }, agentToken).expect(201);

    const doc = stored(res.body.ticket_number);
    expect(doc).toMatchObject({
      source: 'call',
      call_id: 'BZ-9',
      customer_number: '919800000009',
      customer_email: null,
      email_id: null,
      title: 'Callback requested',
      category: 'Follow Up',
      priority: 'High',
      status: 'Open',
    });
    // The agent's own identity fills in when the caller does not supply one.
    expect(doc.agent_number).toBe('1001');
    expect(doc.agent_name).toBe('Ravi Kumar');
    expect(doc.timeline[0]).toMatchObject({ type: 'created', note: 'Ticket created' });
  });

  it('numbers tickets sequentially from the shared counter', async () => {
    const first  = await post({ customer_number: '91980000001', title: 'a' }).expect(201);
    const second = await post({ customer_number: '91980000002', title: 'b' }).expect(201);
    expect(first.body.ticket_number).toBe('TKT-0001');
    expect(second.body.ticket_number).toBe('TKT-0002');
  });
});

describe('POST — from an email', () => {
  it('stores the sender, the message id and the subject', async () => {
    const res = await post({
      source: 'email',
      email_id: 'm7',
      email_subject: 'Cannot upload photograph',
      customer_email: 'Ravi@Example.com',
      customer_name: 'Ravi',
      title: 'Cannot upload photograph',
      description: 'says the upload fails at 90%',
      category: 'Technical Issue',
      priority: 'Urgent',
    }).expect(201);

    const doc = stored(res.body.ticket_number);
    expect(doc).toMatchObject({
      source: 'email',
      email_id: 'm7',
      email_subject: 'Cannot upload photograph',
      // Addresses are case-insensitive, so they are stored folded — otherwise
      // the "tickets for this sender" lookup would miss on casing alone.
      customer_email: 'ravi@example.com',
      customer_number: null,
      call_id: null,
      category: 'Technical Issue',
      priority: 'Urgent',
      status: 'Open',
    });
    expect(doc.timeline[0]).toMatchObject({ type: 'created', note: 'Ticket created from email' });
  });

  it('infers source from email_id when the client omits it', async () => {
    const res = await post({
      email_id: 'm8', customer_email: 'x@example.com', title: 'No source field sent',
    }).expect(201);
    expect(stored(res.body.ticket_number).source).toBe('email');
  });

  it('rejects an unknown source rather than storing it', async () => {
    const res = await post({
      source: 'whatsapp', customer_email: 'x@example.com', title: 'from somewhere else',
    }).expect(201);
    expect(stored(res.body.ticket_number).source).toBe('call');
  });
});

describe('POST — validation', () => {
  it('requires some way to reach the customer', async () => {
    const res = await post({ title: 'no contact details' }).expect(400);
    expect(res.body.error).toMatch(/customer_number or customer_email/);
  });

  it('requires a title, and does not accept a blank one', async () => {
    await post({ customer_number: '919800000001' }).expect(400);
    const res = await post({ customer_email: 'x@example.com', title: '   ' }).expect(400);
    expect(res.body.error).toMatch(/title/);
  });

  it('accepts an email address as the only contact detail', async () => {
    await post({ customer_email: 'x@example.com', title: 'email only' }).expect(201);
  });
});

describe('GET — filters the ticket modals depend on', () => {
  it('finds every ticket raised for one sender', async () => {
    const res = await get('/api/tickets?customerEmail=aasha@example.com').expect(200);
    expect(numbers(res)).toEqual(['TKT-0003']);
  });

  it('folds the queried address to lower case', async () => {
    const res = await get('/api/tickets?customerEmail=Aasha@Example.com').expect(200);
    expect(numbers(res)).toEqual(['TKT-0003']);
  });

  it('finds tickets raised from one specific message', async () => {
    const res = await get('/api/tickets?emailId=m1').expect(200);
    expect(numbers(res)).toEqual(['TKT-0003']);
  });

  it('counts tickets predating the source field as calls', async () => {
    const res = await get('/api/tickets?source=call').expect(200);
    expect(numbers(res).sort()).toEqual(['TKT-0001', 'TKT-0002']);
  });

  it('lists only email tickets for source=email', async () => {
    const res = await get('/api/tickets?source=email').expect(200);
    expect(numbers(res)).toEqual(['TKT-0003']);
  });

  it('leaves the phone-number lookup untouched', async () => {
    const res = await get('/api/tickets?customerNumber=919876543210').expect(200);
    expect(numbers(res)).toEqual(['TKT-0001']);
  });
});

describe('GET — search', () => {
  it('matches on the sender address', async () => {
    const res = await get('/api/tickets?search=aasha@example').expect(200);
    expect(numbers(res)).toEqual(['TKT-0003']);
  });

  it('matches on the email subject', async () => {
    const res = await get('/api/tickets?search=form incomplete').expect(200);
    expect(numbers(res)).toEqual(['TKT-0003']);
  });

  it('treats the term as literal text, not a pattern', async () => {
    // Unescaped, the dot in "aasha.example" would match "aasha@example".
    const res = await get('/api/tickets?search=aasha.example').expect(200);
    expect(numbers(res)).toEqual([]);
  });
});
