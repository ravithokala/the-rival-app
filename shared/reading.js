// @ts-check
// GENERATED from apps-script/domain/reading.js by scripts/sync-shared.js. Do not edit here:
// edit that file and run `npm run sync:shared`.
import { Dates } from './dates.js';

/**
 * Reading (Milestone 5a; docs/PROJECT_BRIEF.md, Reading; ADR-023): books, chapter check-ins and the question bank.
 * A check-in answers 2 questions from the bank and a one-line summary; questions are not repeated within a
 * book until the bank has been used up (then it starts again, avoiding the last check-in's). The pair is the
 * same all day for a book, and "Other questions" moves to the next pair. A book in parts (ADR-031: Part 2 starts again at
 * Chapter 1) numbers its chapters within each part; a check-in without a part is in Part 1. Pure.
 *
 * Shared with the phone app: scripts/sync-shared.js copies this file to pwa/shared/.
 */
const Reading = (() => {
  /** Questions per check-in. */
  const PER_CHECK_IN = 2;

  /** The part a check-in is in: 1 when it has none. @param {Chapter} c */
  const partOf = (c) => (Number.isInteger(c.part) && /** @type {number} */ (c.part) > 1 ? /** @type {number} */ (c.part) : 1);

  /** The live check-ins of a book, in part and chapter order. @param {Chapter[]} chapters @param {string} bookId */
  const checkIns = (chapters, bookId) => chapters.filter((c) => !c.deleted && c.book_id === bookId)
    .sort((a, b) => partOf(a) - partOf(b) || (a.chapter ?? 0) - (b.chapter ?? 0) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /** Whether a book is read in parts: a check-in in Part 2 or later. @param {Chapter[]} chapters @param {string} bookId */
  const hasParts = (chapters, bookId) => checkIns(chapters, bookId).some((c) => partOf(c) > 1);

  /** The part being read: the latest with a check-in, 1 before any. @param {Chapter[]} chapters @param {string} bookId */
  const currentPart = (chapters, bookId) => checkIns(chapters, bookId).reduce((m, c) => Math.max(m, partOf(c)), 1);

  /** A book's check-ins grouped by part, in order. @param {Chapter[]} chapters @param {string} bookId @returns {Array<{ part: number, rows: Chapter[] }>} */
  function byPart(chapters, bookId) {
    /** @type {Array<{ part: number, rows: Chapter[] }>} */
    const out = [];
    for (const c of checkIns(chapters, bookId)) {
      const last = out[out.length - 1];
      if (last && last.part === partOf(c)) last.rows.push(c); else out.push({ part: partOf(c), rows: [c] });
    }
    return out;
  }

  /** Books being read now, the most recently checked-in first. @param {Book[]} books @param {Chapter[]} chapters */
  function current(books, chapters) {
    const last = (/** @type {Book} */ b) => checkIns(chapters, b.book_id).reduce((m, c) => (c.date > m ? c.date : m), b.started ?? '');
    return books.filter((b) => !b.deleted && b.status === 'reading').sort((a, b) => (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : 0));
  }

  /** Finished books, the latest first. @param {Book[]} books */
  const finished = (books) => books.filter((b) => !b.deleted && b.status === 'finished')
    .sort((a, b) => ((a.finished ?? '') < (b.finished ?? '') ? 1 : -1));

  /**
   * What a check-in covers: from the chapter after the previous check-in in its part up to its own ("Ch 1–9"), or one
   * chapter ("Ch 10"). A check-in is per reading session, so it may cover several short chapters.
   * @param {Chapter[]} chapters @param {Chapter} c
   */
  function span(chapters, c) {
    const to = c.chapter ?? 0;
    const from = checkIns(chapters, c.book_id).filter((x) => partOf(x) === partOf(c))
      .reduce((m, x) => ((x.chapter ?? 0) < to ? Math.max(m, x.chapter ?? 0) : m), 0) + 1;
    return from < to ? `Ch ${from}–${to}` : `Ch ${to}`;
  }

  /** As span(), with the part first in a book read in parts: "Part 2 · Ch 1–6". @param {Chapter[]} chapters @param {Chapter} c */
  const label = (chapters, c) => (hasParts(chapters, c.book_id) ? `Part ${partOf(c)} · ${span(chapters, c)}` : span(chapters, c));

  /** The highest chapter checked in within a part, 0 before any. @param {Chapter[]} chapters @param {string} bookId @param {number} part */
  const upTo = (chapters, bookId, part) => checkIns(chapters, bookId).filter((c) => partOf(c) === part).reduce((m, c) => Math.max(m, c.chapter ?? 0), 0);

  /**
   * The chapter a new check-in is for: one after the highest so far in the part (the part being read, unless given).
   * @param {Chapter[]} chapters @param {string} bookId @param {number} [part]
   */
  const nextChapter = (chapters, bookId, part = currentPart(chapters, bookId)) => upTo(chapters, bookId, part) + 1;

  /**
   * The questions for a book's next check-in: 2 not yet asked in this book (or, once the bank is used up, not
   * asked in its last check-in), the same all day; `turn` moves on to the next pair.
   * @param {Question[]} questions @param {Chapter[]} chapters @param {string} bookId @param {string} today @param {number} [turn]
   * @returns {Question[]}
   */
  function questionsFor(questions, chapters, bookId, today, turn = 0) {
    const live = questions.filter((q) => !q.paused && String(q.text ?? '').trim());
    if (live.length <= PER_CHECK_IN) return live;
    const done = checkIns(chapters, bookId);
    const asked = new Set(done.flatMap((c) => c.question_ids));
    const lastAsked = new Set(done.length ? done[done.length - 1].question_ids : []);
    let pool = live.filter((q) => !asked.has(q.question_id));
    if (pool.length < PER_CHECK_IN) pool = live.filter((q) => !lastAsked.has(q.question_id));
    if (pool.length < PER_CHECK_IN) pool = live;
    // Spread across the bank: steady within a day, different across days and books.
    const seed = Dates.daysBetween('2026-01-01', today) + [...bookId].reduce((s, ch) => s + ch.charCodeAt(0), 0) + turn * PER_CHECK_IN;
    const at = ((seed % pool.length) + pool.length) % pool.length;
    const step = Math.max(1, Math.floor(pool.length / PER_CHECK_IN));
    return [pool[at], pool[(at + step) % pool.length]];
  }

  return { PER_CHECK_IN, partOf, checkIns, hasParts, currentPart, byPart, current, finished, span, label, upTo, nextChapter, questionsFor };
})();

export { Reading };
