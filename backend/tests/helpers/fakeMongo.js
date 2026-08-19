/**
 * Minimal in-memory stand-in for the MongoDB driver.
 *
 * There is no mongodb-memory-server in this project and the unit tests must not
 * touch the real Atlas cluster, so this implements just the surface our code
 * actually uses: the query operators and update operators that appear in
 * src/routes and src/workers. Anything else throws loudly rather than silently
 * returning a wrong answer — an unsupported operator means the fake has drifted
 * behind the code and the test is no longer proving what it claims.
 */

/**
 * Read a dotted path, spreading across arrays the way Mongo does: on
 * { tags: [{ category: 'A' }, { category: 'B' }] } the path 'tags.category'
 * yields ['A', 'B'], which the scalar comparison below then matches by
 * membership. Without this, tag filters would silently match nothing.
 */
function resolvePath(doc, path) {
  if (!path.includes('.')) return doc?.[path];

  let current = [doc];
  for (const segment of path.split('.')) {
    const next = [];
    for (const node of current) {
      if (node === null || node === undefined) continue;
      const value = Array.isArray(node)
        ? node.map(item => item?.[segment])
        : [node[segment]];
      for (const v of value) {
        if (Array.isArray(v)) next.push(...v);
        else if (v !== undefined) next.push(v);
      }
    }
    current = next;
  }

  // A single hit reads as a scalar so that $regex, $gt and friends still see
  // the value rather than a one-element array.
  if (current.length === 0) return undefined;
  return current.length === 1 ? current[0] : current;
}

/**
 * Run a test over an array field's elements, or over a scalar as itself.
 * A missing field is tested as `undefined`, which is what makes `$ne` and
 * `$nin` match documents that do not carry the field at all.
 */
function anyElement(value, test) {
  return Array.isArray(value) ? value.some(test) : test(value);
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return cond.every(c => matches(doc, c));
    if (key === '$or')  return cond.some(c => matches(doc, c));

    const value = resolvePath(doc, key);

    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        switch (op) {
          // Equality operators apply ELEMENT-WISE to an array field: $eq/$in
          // match when any element does, $ne/$nin when none does. Comparing the
          // array itself would make `{label_ids: {$ne: 'SENT'}}` true of a
          // message labelled SENT — which is how a reply we sent ends up
          // counted as mail we received.
          case '$ne':      return !anyElement(value, v => v === arg);
          case '$eq':      return  anyElement(value, v => v === arg);
          case '$in':      return  anyElement(value, v => arg.includes(v));
          case '$nin':     return !anyElement(value, v => arg.includes(v));
          case '$gt':      return value >   arg;
          case '$gte':     return value >=  arg;
          case '$lt':      return value <   arg;
          case '$lte':     return value <=  arg;
          // Mongo's $not negates an operator expression, and — the part that is
          // easy to forget — a negation MATCHES a document missing the field
          // entirely. That is exactly what "not replied to" has to mean for a
          // rollup written before the counter existed.
          case '$not':     return !matches(doc, { [key]: arg });
          case '$size':    return Array.isArray(value) && value.length === arg;
          case '$exists':  return (value !== undefined) === arg;
          // Every condition must hold on the SAME array element — the reason
          // tag filters use it instead of two dotted conditions.
          case '$elemMatch':
            return Array.isArray(value) && value.some(item => matches(item, arg));
          // Only the BSON aliases the code actually asks for. Mongo's numeric
          // type codes and the array/object cases are deliberately absent —
          // adding them untested would be guessing at semantics.
          case '$type':
            if (arg === 'string') return typeof value === 'string';
            if (arg === 'number') return typeof value === 'number';
            if (arg === 'bool')   return typeof value === 'boolean';
            if (arg === 'date')   return value instanceof Date;
            if (arg === 'null')   return value === null;
            throw new Error(`fakeMongo: unsupported $type alias ${arg}`);
          case '$regex':   return new RegExp(arg, cond.$options || '').test(String(value ?? ''));
          case '$options': return true;   // consumed by $regex
          default: throw new Error(`fakeMongo: unsupported query operator ${op}`);
        }
      });
    }

    // Mongo matches a scalar against an array field by membership.
    if (Array.isArray(value)) return value.includes(cond);
    if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
    return value === cond;
  });
}

/**
 * Real Mongo rejects an update whose operators name the same field twice —
 * `$setOnInsert: { attempts: 0 }` beside `$set: { attempts: 0 }` fails the whole
 * write, it does not merge. A fake that quietly merged them let a worker ship
 * an enqueue that could never write, so the fake refuses it too, with the
 * server's own wording.
 */
function assertNoPathConflict(update) {
  const seen = new Map();
  for (const [op, spec] of Object.entries(update)) {
    if (!spec || typeof spec !== 'object') continue;
    for (const path of Object.keys(spec)) {
      const previous = seen.get(path);
      if (previous && previous !== op) {
        throw new Error(`Updating the path '${path}' would create a conflict at '${path}'`);
      }
      seen.set(path, op);
    }
  }
}

function applyUpdate(doc, update, { isInsert = false } = {}) {
  assertNoPathConflict(update);
  const out = { ...doc };

  for (const [op, spec] of Object.entries(update)) {
    switch (op) {
      case '$set':
        Object.assign(out, spec);
        break;
      case '$setOnInsert':
        if (isInsert) Object.assign(out, spec);
        break;
      // Removes the key outright — the distinction from setting null matters to
      // any filter written as { field: { $exists: false } }.
      case '$unset':
        for (const key of Object.keys(spec)) delete out[key];
        break;
      case '$inc':
        for (const [k, v] of Object.entries(spec)) out[k] = (out[k] || 0) + v;
        break;
      case '$addToSet':
        for (const [k, v] of Object.entries(spec)) {
          const items = v && typeof v === 'object' && '$each' in v ? v.$each : [v];
          out[k] = [...new Set([...(out[k] || []), ...items])];
        }
        break;
      case '$pull':
        for (const [k, v] of Object.entries(spec)) {
          const remove = v && typeof v === 'object' && '$in' in v ? v.$in : [v];
          out[k] = (out[k] || []).filter(item => !remove.includes(item));
        }
        break;
      case '$push':
        for (const [k, v] of Object.entries(spec)) {
          const items = v && typeof v === 'object' && '$each' in v ? v.$each : [v];
          out[k] = [...(out[k] || []), ...items];
        }
        break;
      default:
        throw new Error(`fakeMongo: unsupported update operator ${op}`);
    }
  }

  return out;
}

/* ── Aggregation ─────────────────────────────────────────────────────────────
 * Enough of the pipeline to run GET /api/calls, which uses aggregate() so that
 * null/missing values sort last regardless of direction.
 *
 * This approximates MongoDB's comparison semantics rather than reproducing them:
 * missing and null are treated as equal and rank below every other value, which
 * is what the two $cond expressions in routes/calls.js depend on. It is enough
 * to prove OUR filter/sort/shape logic; it is not a claim about Mongo itself.
 */

/** null and undefined (missing) rank below everything else, and equal each other. */
function bsonRank(v) {
  return v === null || v === undefined ? 0 : 1;
}

function bsonCompare(a, b) {
  const ra = bsonRank(a);
  const rb = bsonRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() - new Date(b).getTime();
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) > String(b) ? 1 : String(a) < String(b) ? -1 : 0;
}

function evalExpr(expr, doc) {
  // Field paths may be dotted ('$_tag_list.category'), which is how the tag
  // pipelines read a field off an unwound sub-document.
  if (typeof expr === 'string' && expr.startsWith('$')) return resolvePath(doc, expr.slice(1));
  if (expr === null || typeof expr !== 'object') return expr;
  if (Array.isArray(expr)) return expr.map(e => evalExpr(e, doc));

  const [op, arg] = Object.entries(expr)[0];

  // A plain object literal, e.g. a compound $group _id
  // ({ category: '$category', sub_category: '$sub_category' }) — evaluate each
  // value rather than reading the first key as an operator.
  if (!op.startsWith('$')) {
    return Object.fromEntries(Object.entries(expr).map(([k, v]) => [k, evalExpr(v, doc)]));
  }

  switch (op) {
    case '$cond': {
      const [cond, whenTrue, whenFalse] = Array.isArray(arg) ? arg : [arg.if, arg.then, arg.else];
      return evalExpr(cond, doc) ? evalExpr(whenTrue, doc) : evalExpr(whenFalse, doc);
    }
    case '$and': return arg.every(e => Boolean(evalExpr(e, doc)));
    case '$or':  return arg.some(e => Boolean(evalExpr(e, doc)));
    case '$not': return !evalExpr(arg, doc);
    case '$eq':  return bsonCompare(evalExpr(arg[0], doc), evalExpr(arg[1], doc)) === 0;
    case '$ne':  return bsonCompare(evalExpr(arg[0], doc), evalExpr(arg[1], doc)) !== 0;
    case '$gt':  return bsonCompare(evalExpr(arg[0], doc), evalExpr(arg[1], doc)) >   0;
    case '$gte': return bsonCompare(evalExpr(arg[0], doc), evalExpr(arg[1], doc)) >=  0;
    case '$lt':  return bsonCompare(evalExpr(arg[0], doc), evalExpr(arg[1], doc)) <   0;
    case '$lte': return bsonCompare(evalExpr(arg[0], doc), evalExpr(arg[1], doc)) <=  0;
    case '$ifNull': {
      const value = evalExpr(arg[0], doc);
      return value === null || value === undefined ? evalExpr(arg[1], doc) : value;
    }
    case '$size': {
      const value = evalExpr(arg, doc);
      return Array.isArray(value) ? value.length : 0;
    }
    // The expression form, as used by $addFields to unwrap a $lookup result.
    // Distinct from the $group accumulator of the same name, which is handled
    // in the $group stage below.
    case '$first': {
      const value = evalExpr(arg, doc);
      return Array.isArray(value) ? value[0] : value;
    }
    default: throw new Error(`fakeMongo: unsupported aggregation expression ${op}`);
  }
}

/**
 * @param {Array<object>} docs
 * @param {Array<object>} pipeline
 * @param {object} [store] all collections, needed only by $lookup
 */
function runPipeline(docs, pipeline, store = {}) {
  let rows = docs.map(d => ({ ...d }));

  for (const stage of pipeline) {
    const [op, spec] = Object.entries(stage)[0];
    switch (op) {
      case '$match':
        rows = rows.filter(d => matches(d, spec));
        break;
      case '$addFields':
      case '$set':
        rows = rows.map(d => ({ ...d, ...Object.fromEntries(Object.entries(spec).map(([k, e]) => [k, evalExpr(e, d)])) }));
        break;
      case '$sort':
        // Later keys break ties in earlier keys, exactly like Mongo.
        rows = [...rows].sort((a, b) => {
          for (const [key, dir] of Object.entries(spec)) {
            const cmp = bsonCompare(a[key], b[key]) * dir;
            if (cmp !== 0) return cmp;
          }
          return 0;
        });
        break;
      case '$unwind': {
        // Path form only ('$field'), which is all the tag pipelines use. An
        // empty or missing array drops the document, matching Mongo's default
        // (preserveNullAndEmptyArrays is not requested anywhere in src).
        const field = (typeof spec === 'string' ? spec : spec.path).replace(/^\$/, '');
        const out = [];
        for (const row of rows) {
          const value = row[field];
          if (Array.isArray(value)) out.push(...value.map(item => ({ ...row, [field]: item })));
          else if (value !== undefined && value !== null) out.push(row);
        }
        rows = out;
        break;
      }
      case '$skip':
        rows = rows.slice(spec);
        break;
      case '$limit':
        rows = rows.slice(0, spec);
        break;
      case '$project':
        rows = rows.map(d => project(d, spec));
        break;
      case '$count':
        rows = [{ [spec]: rows.length }];
        break;
      case '$group': {
        // _id may be null, a field path ('$field'), or an object of field paths.
        const keyOf = doc => (spec._id === null ? null : evalExpr(spec._id, doc));
        const accumulators = Object.entries(spec).filter(([k]) => k !== '_id');
        const groups = new Map();

        for (const doc of rows) {
          const id = keyOf(doc);
          const hash = JSON.stringify(id ?? null);
          if (!groups.has(hash)) groups.set(hash, { _id: id, docs: [] });
          groups.get(hash).docs.push(doc);
        }

        rows = [...groups.values()].map(({ _id, docs }) => {
          const out = { _id };
          for (const [field, acc] of accumulators) {
            const [op, arg] = Object.entries(acc)[0];
            const values = docs.map(d => evalExpr(arg, d));
            switch (op) {
              case '$sum':   out[field] = arg === 1 ? docs.length : values.reduce((a, v) => a + (Number(v) || 0), 0); break;
              case '$avg': {
                const nums = values.filter(v => typeof v === 'number');
                out[field] = nums.length ? nums.reduce((a, v) => a + v, 0) / nums.length : null;
                break;
              }
              case '$first': out[field] = values[0]; break;
              case '$last':  out[field] = values[values.length - 1]; break;
              case '$push':  out[field] = values; break;
              case '$addToSet': out[field] = [...new Set(values)]; break;
              case '$min':   out[field] = values.reduce((a, v) => (bsonCompare(v, a) < 0 ? v : a), values[0]); break;
              case '$max':   out[field] = values.reduce((a, v) => (bsonCompare(v, a) > 0 ? v : a), values[0]); break;
              default: throw new Error(`fakeMongo: unsupported accumulator ${op}`);
            }
          }
          return out;
        });
        break;
      }
      case '$lookup': {
        // Equality-join form only (from/localField/foreignField/as) — the
        // pipeline/let form is not used anywhere in src.
        const { from, localField, foreignField, as } = spec;
        if (!from || !localField || !foreignField || !as) {
          throw new Error('fakeMongo: $lookup supports only the from/localField/foreignField/as form');
        }
        const foreign = [...(store[from]?.values() ?? [])];
        rows = rows.map(d => ({
          ...d,
          [as]: foreign.filter(f => f[foreignField] === d[localField]),
        }));
        break;
      }
      default:
        throw new Error(`fakeMongo: unsupported aggregation stage ${op}`);
    }
  }

  return rows;
}

function project(doc, projection) {
  if (!projection) return doc;
  const include = Object.entries(projection).filter(([, v]) => v === 1).map(([k]) => k);
  const exclude = Object.entries(projection).filter(([, v]) => v === 0).map(([k]) => k);
  if (include.length) {
    return Object.fromEntries(Object.entries(doc).filter(([k]) => include.includes(k) || k === '_id'));
  }
  return Object.fromEntries(Object.entries(doc).filter(([k]) => !exclude.includes(k)));
}

/**
 * Primary key per collection, mirroring the unique indexes in src/db.js. This
 * matters because insertOne() rejects a duplicate key with code 11000, which is
 * the branch the webhook's upsert-on-conflict path depends on.
 */
const DEFAULT_KEYS = {
  emails:         'gmail_id',
  email_analysis: 'gmail_id',
  calls:          'call_id',
  call_analysis:  'call_id',
  agents:         'agent_number',
};

/**
 * @param {Record<string, Array<object>>} seed  collection name → starting documents
 * @param {(name: string, doc: object) => any} [keyFor]  primary key extractor per collection
 */
function createFakeDb(seed = {}, keyFor = (name, doc) => doc[DEFAULT_KEYS[name] ?? '_id']) {
  const store = {};
  for (const [name, docs] of Object.entries(seed)) {
    store[name] = new Map(docs.map(d => [keyFor(name, d), { ...d }]));
  }

  function collection(name) {
    const map = store[name] || (store[name] = new Map());
    const select = filter => [...map.values()].filter(d => matches(d, filter));
    // Upserts need a key even though the document does not exist yet; the
    // filter is the only place one can come from.
    const keyFromFilter = filter => filter[DEFAULT_KEYS[name] ?? '_id'];

    const api = {
      find(filter = {}, opts = {}) {
        let rows = select(filter);
        const cursor = {
          sort(spec) {
            const [key, dir] = Object.entries(spec)[0];
            rows = [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
            return cursor;
          },
          skip(n)  { rows = rows.slice(n); return cursor; },
          limit(n) { rows = rows.slice(0, n); return cursor; },
          toArray() { return Promise.resolve(rows.map(d => project(d, opts.projection))); },
        };
        return cursor;
      },

      aggregate(pipeline = []) {
        const rows = runPipeline([...map.values()], pipeline, store);
        return {
          toArray: () => Promise.resolve(rows),
          // The export walks the cursor with `for await` rather than buffering
          // it — a fake that only offers toArray() cannot exercise that path.
          async *[Symbol.asyncIterator]() { for (const row of rows) yield row; },
        };
      },

      findOne(filter = {}, opts = {}) {
        const [doc] = select(filter);
        return Promise.resolve(doc ? project(doc, opts.projection) : null);
      },

      countDocuments(filter = {}) {
        return Promise.resolve(select(filter).length);
      },

      /**
       * Distinct values of one field across matching documents. Mongo flattens
       * array fields into their elements and drops missing ones; the search
       * path in lib/conversations depends on both.
       */
      distinct(field, filter = {}) {
        const out = new Set();
        for (const doc of select(filter)) {
          const value = resolvePath(doc, field);
          if (value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value]) out.add(item);
        }
        return Promise.resolve([...out]);
      },

      insertOne(doc) {
        const key = keyFor(name, doc);
        // Mimic the unique-index violation the webhook's upsert path relies on
        // (it catches code 11000 and merges instead of inserting).
        if (key !== undefined && map.has(key)) {
          return Promise.reject(Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }));
        }
        map.set(key, { ...doc });
        return Promise.resolve({ acknowledged: true, insertedId: key });
      },

      updateOne(filter, update, opts = {}) {
        const [existing] = select(filter);
        if (!existing && !opts.upsert) return Promise.resolve({ matchedCount: 0, modifiedCount: 0, upsertedCount: 0 });
        const isInsert = !existing;
        const next = applyUpdate(existing || { ...filter }, update, { isInsert });
        map.set(isInsert ? keyFromFilter(filter) : keyFor(name, existing), next);
        return Promise.resolve({
          matchedCount:  isInsert ? 0 : 1,
          modifiedCount: isInsert ? 0 : 1,
          upsertedCount: isInsert ? 1 : 0,
        });
      },

      /**
       * The atomic claim primitive both analysis workers rely on. Single-
       * threaded here, so atomicity is free; what matters is honouring `sort`
       * (which record gets claimed) and `returnDocument` (the worker needs the
       * post-update doc to learn its own processing_id).
       */
      findOneAndUpdate(filter, update, opts = {}) {
        let rows = select(filter);
        if (opts.sort) {
          const [key, dir] = Object.entries(opts.sort)[0];
          rows = [...rows].sort((a, b) => bsonCompare(a[key], b[key]) * dir);
        }
        const [existing] = rows;
        if (!existing) {
          if (!opts.upsert) return Promise.resolve(null);
          const created = applyUpdate({ ...filter }, update, { isInsert: true });
          map.set(keyFromFilter(filter), created);
          return Promise.resolve(opts.returnDocument === 'after' ? created : null);
        }
        const next = applyUpdate(existing, update);
        map.set(keyFor(name, existing), next);
        return Promise.resolve(opts.returnDocument === 'after' ? next : existing);
      },

      updateMany(filter, update) {
        let modified = 0;
        for (const doc of select(filter)) {
          map.set(keyFor(name, doc), applyUpdate(doc, update));
          modified += 1;
        }
        return Promise.resolve({ matchedCount: modified, modifiedCount: modified });
      },

      bulkWrite(ops) {
        let modifiedCount = 0;
        let upsertedCount = 0;
        for (const op of ops) {
          if (!op.updateOne) throw new Error('fakeMongo: only updateOne bulk ops are supported');
          const { filter, update, upsert } = op.updateOne;
          const [existing] = select(filter);
          if (!existing && !upsert) continue;
          const isInsert = !existing;
          const next = applyUpdate(existing || { ...filter }, update, { isInsert });
          map.set(isInsert ? keyFromFilter(filter) : keyFor(name, existing), next);
          if (isInsert) upsertedCount += 1; else modifiedCount += 1;
        }
        return Promise.resolve({ modifiedCount, upsertedCount });
      },

      deleteOne(filter = {}) {
        const [doc] = select(filter);
        if (!doc) return Promise.resolve({ deletedCount: 0 });
        map.delete(keyFor(name, doc));
        return Promise.resolve({ deletedCount: 1 });
      },

      deleteMany(filter = {}) {
        const docs = select(filter);
        for (const doc of docs) map.delete(keyFor(name, doc));
        return Promise.resolve({ deletedCount: docs.length });
      },

      createIndex() { return Promise.resolve('ok'); },
    };

    return api;
  }

  return { db: { collection }, store, collection };
}

module.exports = { createFakeDb, matches, applyUpdate };
