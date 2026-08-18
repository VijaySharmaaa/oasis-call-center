/**
 * TagChips — what an operator actually sees once an item can carry many tags.
 *
 * The component is the whole UI contract of tagging, so the cases that matter
 * are: every tag surfaces, the legacy scalar pair still renders, and a
 * hallucinating model cannot flood a table row.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TagChips, { tagsOf } from '../components/TagChips';

const TWO_TAGS = {
  category: 'Identity Verification',
  sub_category: 'Aadhaar OTP Not Received',
  tags: [
    { category: 'Identity Verification', sub_category: 'Aadhaar OTP Not Received' },
    { category: 'Uploads & Documents',   sub_category: 'Photograph Upload Issue' },
  ],
};

// Analysed before tagging existed: a scalar pair and no tags array.
const LEGACY = { category: 'Payment & Fee', sub_category: 'Fee Amount Query' };

describe('an item with several tags', () => {
  it('shows every tag, not just the primary one', () => {
    render(<TagChips item={TWO_TAGS} max={5} />);
    expect(screen.getByText('Identity Verification')).toBeInTheDocument();
    expect(screen.getByText('Uploads & Documents')).toBeInTheDocument();
  });

  it('collapses the overflow into a +N chip that names what is hidden', () => {
    render(<TagChips item={TWO_TAGS} max={1} />);
    expect(screen.getByText('Identity Verification')).toBeInTheDocument();
    expect(screen.queryByText('Uploads & Documents')).not.toBeInTheDocument();
    expect(screen.getByTitle('Uploads & Documents')).toHaveTextContent('+1');
  });

  it('appends the sub-category only when asked', () => {
    const { rerender } = render(<TagChips item={TWO_TAGS} max={1} />);
    expect(screen.queryByText(/Aadhaar OTP Not Received/)).not.toBeInTheDocument();

    rerender(<TagChips item={TWO_TAGS} max={1} showSub />);
    expect(screen.getByText(/Aadhaar OTP Not Received/)).toBeInTheDocument();
  });

  it('always carries the full pair in the title, however narrow the cell', () => {
    render(<TagChips item={TWO_TAGS} max={5} />);
    expect(screen.getByTitle('Identity Verification · Aadhaar OTP Not Received')).toBeInTheDocument();
  });
});

describe('records that predate tagging', () => {
  it('renders the scalar pair as a single tag', () => {
    render(<TagChips item={LEGACY} />);
    expect(screen.getByText('Payment & Fee')).toBeInTheDocument();
  });

  it('reads as pending when there is nothing at all', () => {
    render(<TagChips item={{}} />);
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('prefers the tags array when both shapes are present', () => {
    // Mid-backfill a document holds both; the array is the newer truth.
    const both = { category: 'Stale Category', tags: [{ category: 'Exam Information', sub_category: 'Syllabus Query' }] };
    expect(tagsOf(both)).toEqual([{ category: 'Exam Information', sub_category: 'Syllabus Query' }]);
    render(<TagChips item={both} />);
    expect(screen.queryByText('Stale Category')).not.toBeInTheDocument();
  });
});

describe('tagsOf', () => {
  it('falls back to the scalar pair, then to nothing', () => {
    expect(tagsOf(LEGACY)).toEqual([{ category: 'Payment & Fee', sub_category: 'Fee Amount Query' }]);
    expect(tagsOf({ tags: [] })).toEqual([]);
    expect(tagsOf({})).toEqual([]);
    expect(tagsOf(null)).toEqual([]);
  });
});
