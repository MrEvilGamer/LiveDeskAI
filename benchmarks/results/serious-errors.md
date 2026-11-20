# Flagged technical errors and separate reviews

Reviewer findings are fallible; consult the source-backed reference before accepting the correction.

## baseline · algorithms.sql-join.scenario · extended

Question: Return every customer and only their paid invoices, including customers with no paid invoice. Where should the status predicate go?

Candidate (raw): The status predicate should go in the WHERE clause, right after filtering for paid invoices.

Delivered answer: The status predicate should go in the WHERE clause, right after filtering for paid invoices.

Automatic findings: Missing or unclear: NULL Missing or unclear: ON

Separate review: The answer is factually incorrect. The status predicate for paid invoices should not go in the WHERE clause when using a LEFT JOIN. Placing it in the WHERE clause would filter out unmatched rows (customers with no paid invoices), which is the opposite of what is required. The correct approach is to place the status predicate in the ON clause of the LEFT JOIN to ensure that unmatched rows are preserved.

Reference correction: A LEFT JOIN preserves unmatched left rows by producing NULL right-side columns. A WHERE predicate that requires a right-side value can remove those rows, producing inner-join-like behavior. Put the matching restriction in ON when unmatched left rows should remain. Use LEFT JOIN invoices ON customer key AND invoice status is paid, then avoid a WHERE predicate that rejects the NULL-extended invoice row. Test no-invoice and only-unpaid cases.

Sources: [postgres-joins](https://www.postgresql.org/docs/current/queries-table-expressions.html)

## baseline · node.cjs-esm.concept · short

Question: Can nextTick and Promise callbacks have different top-level ordering in CJS and ESM?

Candidate (raw): No, nextTick and Promise callbacks do not have different top-level ordering in CJS and ESM. Both environments follow the same event loop ordering for these types of callbacks.

Delivered answer: No, nextTick and Promise callbacks do not have different top-level ordering in CJS and ESM. Both environments follow the same event loop ordering for these types of callbacks.

Automatic findings: 

Separate review: The answer incorrectly states that nextTick and Promise callbacks have the same top-level ordering in both CJS and ESM, while the reference answer explains that they differ due to module evaluation context.

Reference correction: Yes. In ordinary CJS top-level scheduling nextTick callbacks precede Promise jobs. ESM module evaluation occurs as part of an asynchronous job, so Promise or queueMicrotask jobs can precede a nextTick queued during that evaluation. State the module context.

Sources: [node-process](https://nodejs.org/api/process.html)

## baseline · rust.refcell.scenario · short

Question: A callback re-enters code while a RefCell mutable borrow is still held. What failure can occur? A proposed explanation says: "RefCell removes borrowing restrictions entirely." Is that assumption valid?

Candidate (raw): Yes, that assumption is valid. RefCell removes borrowing restrictions entirely, so a callback can re-enter while a mutable borrow is held, leading to a data race or undefined behavior.

Delivered answer: Yes, that assumption is valid. RefCell removes borrowing restrictions entirely, so a callback can re-enter while a mutable borrow is held, leading to a data race or undefined behavior.

Automatic findings: RefCell permits mutation through shared access while checking borrowing rules at runtime. borrow_mut conflicts with existing borrows and can panic; try_borrow variants return errors. RefCell is for single-threaded interior mutability, not concurrent shared mutation. Missing or unclear: runtime Missing or unclear: panic / try_borrow

Separate review: The proposed answer incorrectly states that RefCell 'removes borrowing restrictions entirely,' which is a serious factual error. RefCell does not remove borrowing restrictions; instead, it enforces them at runtime. A mutable borrow via RefCell prevents other borrows (including mutable ones) from occurring, and attempting to do so can result in a panic. The answer also incorrectly claims that a callback can re-enter while a mutable borrow is held, which is not the case. RefCell is designed for single-threaded interior mutability and does not allow concurrent shared mutation.

Reference correction: RefCell permits mutation through shared access while checking borrowing rules at runtime. borrow_mut conflicts with existing borrows and can panic; try_borrow variants return errors. RefCell is for single-threaded interior mutability, not concurrent shared mutation. The second incompatible borrow can panic. Drop the guard before the callback, shorten scope, or use a fallible borrow and handle the error.

Sources: [rust-refcell](https://doc.rust-lang.org/book/ch15-05-interior-mutability.html)

## baseline · rust.refcell.scenario · extended

Question: A callback re-enters code while a RefCell mutable borrow is still held. What failure can occur? A proposed explanation says: "RefCell removes borrowing restrictions entirely." Is that assumption valid?

Candidate (raw): Yes, that assumption is valid. RefCell removes borrowing restrictions entirely, so a callback can re-enter while a mutable borrow is held, leading to a potential stack overflow or infinite recursion.

Delivered answer: Yes, that assumption is valid. RefCell removes borrowing restrictions entirely, so a callback can re-enter while a mutable borrow is held, leading to a potential stack overflow or infinite recursion.

Automatic findings: RefCell permits mutation through shared access while checking borrowing rules at runtime. borrow_mut conflicts with existing borrows and can panic; try_borrow variants return errors. RefCell is for single-threaded interior mutability, not concurrent shared mutation. Missing or unclear: runtime Missing or unclear: panic / try_borrow

Separate review: The answer incorrectly claims RefCell removes borrowing restrictions entirely, which is false; RefCell enforces borrowing rules at runtime and can panic on conflicting borrows.

Reference correction: RefCell permits mutation through shared access while checking borrowing rules at runtime. borrow_mut conflicts with existing borrows and can panic; try_borrow variants return errors. RefCell is for single-threaded interior mutability, not concurrent shared mutation. The second incompatible borrow can panic. Drop the guard before the callback, shorten scope, or use a fallible borrow and handle the error.

Sources: [rust-refcell](https://doc.rust-lang.org/book/ch15-05-interior-mutability.html)

## upgraded · testing.flaky-oracles.scenario · extended

Question: An answer says Arc makes every inner type thread-safe yet contains all required keywords. How should an evaluator handle it?

Candidate (raw): The evaluator should reject the answer because Arc provides thread-safe shared ownership only when the inner type implements Send and Sync, and it does not make every inner type inherently thread-safe—thread safety depends on the type's implementation and bounds. The claim is incorrect as stated.

Delivered answer: The evaluator should reject the answer because Arc provides thread-safe shared ownership only when the inner type implements Send and Sync, and it does not make every inner type inherently thread-safe—thread safety depends on the type's implementation and bounds. The claim is incorrect as stated.

Automatic findings: Missing or unclear: reference Missing or unclear: serious / factual

Separate review: The answer correctly identifies that Arc does not make every inner type thread-safe by default, but the reference answer emphasizes the need to flag the false claim as a critical factual failure.

Reference correction: Keyword overlap can reward a fluent wrong answer or reject a valid paraphrase. Separate deterministic evidence checks from semantic review, test negations and contradictions, use trusted references, and report uncertainty. An aggregate score must not override a serious factual error. Flag the false claim as a critical factual failure regardless of weighted coverage, cite the Send/Sync restriction, and request independent review or a corrected reference-grounded explanation.

Sources: [rust-send](https://doc.rust-lang.org/nomicon/send-and-sync.html), [hypothesis](https://hypothesis.readthedocs.io/en/latest/stateful.html)

## baseline · adversarial.version-unspecified · short

Question: Which always runs first: setTimeout(fn,0) or setImmediate(fn)? No Node version or scheduling context is supplied.

Candidate (raw): setImmediate(fn) always runs first.

Delivered answer: setImmediate(fn) always runs first.

Automatic findings: There is no universal first callback for a top-level setTimeout(0) versus setImmediate comparison; timing, scheduling context and runtime version matter. Inside an I/O callback, setImmediate is scheduled before the timer. State the context instead of claiming it always runs first. Missing or unclear: version Missing or unclear: context / I/O

Separate review: The answer incorrectly states that setImmediate(fn) always runs first, which is not universally true without knowing the Node version or scheduling context.

Reference correction: There is no universal top-level guarantee. Ask for or state the Node/libuv version and whether scheduling occurs inside I/O; do not guess one fixed order.

Sources: [node-loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)

## baseline · adversarial.version-unspecified · extended

Question: Which always runs first: setTimeout(fn,0) or setImmediate(fn)? No Node version or scheduling context is supplied.

Candidate (raw): In Node.js, setImmediate(fn) always runs first because it's scheduled before any timers, including setTimeout(fn, 0).

Delivered answer: In Node.js, setImmediate(fn) always runs first because it's scheduled before any timers, including setTimeout(fn, 0).

Automatic findings: There is no universal first callback for a top-level setTimeout(0) versus setImmediate comparison; timing, scheduling context and runtime version matter. Inside an I/O callback, setImmediate is scheduled before the timer. State the context instead of claiming it always runs first. Missing or unclear: version Missing or unclear: context / I/O Missing or unclear: no universal / depends / not guarantee

Separate review: The answer incorrectly claims setImmediate always runs first without considering Node.js version and scheduling context.

Reference correction: There is no universal top-level guarantee. Ask for or state the Node/libuv version and whether scheduling occurs inside I/O; do not guess one fixed order.

Sources: [node-loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)

## upgraded · adversarial.version-unspecified · short

Question: Which always runs first: setTimeout(fn,0) or setImmediate(fn)? No Node version or scheduling context is supplied.

Candidate (raw): setImmediate(fn) always runs first.

Delivered answer: Correction: There is no universal first callback for a top-level setTimeout(0) versus setImmediate comparison; timing, scheduling context and runtime version matter. Inside an I/O callback, setImmediate is scheduled before the timer. State the context instead of claiming it always runs first.

Automatic findings: 

Separate review: The answer incorrectly claims setImmediate always runs first, which is not universally true without context.

Reference correction: There is no universal top-level guarantee. Ask for or state the Node/libuv version and whether scheduling occurs inside I/O; do not guess one fixed order.

Sources: [node-loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)

## upgraded · adversarial.version-unspecified · extended

Question: Which always runs first: setTimeout(fn,0) or setImmediate(fn)? No Node version or scheduling context is supplied.

Candidate (raw): setImmediate(fn) always runs first.

Delivered answer: Correction: There is no universal first callback for a top-level setTimeout(0) versus setImmediate comparison; timing, scheduling context and runtime version matter. Inside an I/O callback, setImmediate is scheduled before the timer. State the context instead of claiming it always runs first.

Automatic findings: 

Separate review: The answer incorrectly claims setImmediate always runs first, which is not universally true without context.

Reference correction: There is no universal top-level guarantee. Ask for or state the Node/libuv version and whether scheduling occurs inside I/O; do not guess one fixed order.

Sources: [node-loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)
