# Independent error checks

The separate local reviewer is fallible. Its serious-error findings were checked against these executable oracles rather than accepted from score alone:

- `algorithms.sql-join.scenario` baseline extended: the answer places the paid-invoice predicate in WHERE. The SQLite fixture preserves both customers with the predicate in ON and returns none when it is moved to WHERE. This checks outer-join filtering semantics, not PostgreSQL RLS.
- `rust.refcell.scenario` baseline short and extended: the answers say RefCell removes borrowing restrictions. The Rust runtime fixture holds one mutable borrow and attempts another; it terminates with a borrow panic. The related compiler fixture rejects sharing Arc<RefCell<T>> across threads. Re-entering a callback is possible; attempting a conflicting borrow is what panics. The reviewer wording must not be read as a claim that callbacks themselves cannot re-enter.
- `node.cjs-esm.concept` baseline short: the answer equates top-level nextTick/Promise ordering across CommonJS and ESM. The actual installed Node executable produces tick-before-promise in the CommonJS fixture and promise-before-tick at ESM top level. This is scoped to the installed version and execution contexts, not a universal order across all callbacks.

The 22 check results and toolchain versions are in executable-oracles.json. None of these fixtures proves every sentence in the full answer bank, and no model-review sample is an exhaustive semantic-accuracy estimate.

The upgraded outbox answer also incorrectly conflated the atomic database write with broker publication. The [transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html) specifies a separate relay and possible duplicate sends. A SQLite rollback-and-duplicate-relay simulation checks the atomic database step and consumer deduplication boundary. This is a bounded simulation, not a Kafka integration test. The final guard supplies a labeled source correction; the raw model claim remains available for separate review.

The adversarial timer answers in both pipelines also make an unqualified setImmediate-before-setTimeout guarantee. The [Node event-loop documentation](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) distinguishes nondeterministic main-module scheduling from the I/O-callback exception. The context-aware guard corrects the former and preserves the latter; its regression tests cover both. This guarantee is checked against documentation, not inferred from one favorable timer run.
