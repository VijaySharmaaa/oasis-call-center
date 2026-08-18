import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL ?? '';

const CATEGORIES = ['General Inquiry', 'Technical Issue', 'Billing', 'Complaint', 'Service Request', 'Follow Up', 'Others'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const PRIORITY_COLORS = {
  Low:    'text-slate-500 bg-slate-100 dark:bg-zinc-800 dark:text-zinc-400',
  Medium: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400',
  High:   'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-400',
  Urgent: 'text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400',
};

/**
 * Create a ticket from either source. `call` and `email` are mutually
 * exclusive: whichever is passed decides how the customer is identified —
 * by phone number for a call, by address for an email.
 */
export default function CreateTicketModal({ call, email, onClose, onCreated }) {
  const { token, user } = useAuth();
  const isEmail = !!email;

  const [form, setForm] = useState({
    customer_name:   email?.from_name || '',
    customer_number: call?.caller_number || call?.called_number || '',
    customer_email:  email?.from_email || '',
    // A subject line is already a summary of the problem, so it seeds the
    // title — still editable before submitting.
    title:           email?.subject || '',
    description:     '',
    category:        'General Inquiry',
    priority:        'Medium',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/tickets`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          source:          isEmail ? 'email' : 'call',
          call_id:         call?.call_id || call?.id || null,
          email_id:        email?.id || null,
          email_subject:   email?.subject || null,
          customer_name:   form.customer_name.trim() || null,
          customer_number: isEmail ? null : form.customer_number,
          customer_email:  isEmail ? form.customer_email : null,
          agent_number:    call?.agent_number || user?.agent_number || null,
          agent_name:      call?.agent_name   || user?.name         || null,
          title:           form.title.trim(),
          description:     form.description.trim(),
          category:        form.category,
          priority:        form.priority,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create ticket'); return; }
      onCreated?.(data);
      onClose();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-zinc-700">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">Create Ticket</h2>
            {call  && <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">From call · {call.caller_number}</p>}
            {email && <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 break-all">From email · {email.from_email}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Customer Name + Number */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ticket-customer-name" className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Customer Name</label>
              <input
                id="ticket-customer-name"
                type="text"
                value={form.customer_name}
                onChange={e => set('customer_name', e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="Customer full name"
              />
            </div>
            <div>
              <label htmlFor="ticket-customer-contact" className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">
                {isEmail ? 'Customer Email' : 'Customer Number'}
              </label>
              <input
                id="ticket-customer-contact"
                type="text"
                value={isEmail ? form.customer_email : form.customer_number}
                readOnly
                title={isEmail ? form.customer_email : undefined}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-lg text-sm text-slate-500 dark:text-zinc-400 cursor-not-allowed select-none truncate"
              />
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="ticket-title" className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Title <span className="text-red-500">*</span></label>
            <input
              id="ticket-title"
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Brief summary of the issue"
              required
            />
          </div>

          {/* Category + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ticket-category" className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Category</label>
              <select
                id="ticket-category"
                value={form.category}
                onChange={e => set('category', e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
              >
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ticket-priority" className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Priority</label>
              <select
                id="ticket-priority"
                value={form.priority}
                onChange={e => set('priority', e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-sm font-medium focus:outline-none focus:border-indigo-500 transition-colors ${PRIORITY_COLORS[form.priority]} border-slate-300 dark:border-zinc-700`}
              >
                {PRIORITIES.map(p => <option key={p} className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-normal">{p}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="ticket-description" className="block text-xs font-medium text-slate-600 dark:text-zinc-400 mb-1">Description</label>
            <textarea
              id="ticket-description"
              rows={4}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
              placeholder="Detailed description of the issue…"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              {loading && <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="25" strokeDashoffset="6"/></svg>}
              Create Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
