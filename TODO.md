# TODO - CursorStore resume (Issue #296)

- [x] Step 1: Analyze repo + locate relevant files.
- [ ] Step 2: Rewrite `packages/pulse-core/src/EventEngine.ts` to remove merge conflicts and implement horizon cursor resume + persistence using keys `horizon:${network}`.
- [ ] Step 3: Rewrite `packages/pulse-core/src/SorobanSubscriber.ts` to remove corruption and implement soroban cursor resume + persistence using keys `soroban:${network}` (or provided `streamKey`).
- [ ] Step 4: Update `packages/pulse-core/test/EventEngine.cursorResume.test.ts` to compile and validate horizon + soroban resume and tolerant set failure.
- [ ] Step 5: Run `pnpm -C packages/pulse-core test` and ensure all tests pass.

