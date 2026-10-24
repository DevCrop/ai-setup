# Strict review checklist

Every item that fails is a blocking finding unless it is purely cosmetic (naming taste, formatting a linter would fix).

## SOLID, one check each
- S, single responsibility: can you name the class or module's one reason to change in a short sentence without "and"? If not, it does two things.
- O, open/closed: did adding this case edit a growing `if/elif` or `switch` on a type that already has three or more branches? Then a table or polymorphism is due, not before.
- L, Liskov: does every subclass or implementation accept the same inputs and keep the base contract (no new exceptions, no narrower inputs, no ignored methods)?
- I, interface segregation: does any implementer leave a method empty or raising "not supported"? Split the interface.
- D, dependency inversion: does domain code import the DB driver, HTTP client, `datetime.now()` or `random` directly? Pass them in from the edge instead.

## Over-engineering (Ponytail still applies)
- An interface, base class, factory or layer with one implementation and no test that uses the seam is a finding. Remove it.

## Side effects
- List every I/O the change adds or moves: DB writes, network calls, files, the clock, global or shared state.
- Domain functions return values; they do not write, send or read the clock.

## What else it touches
- Callers: `grep` every caller of each changed function; are they all updated?
- Shared state: caches, singletons, module-level variables, sessions.
- Migrations: is the schema change reversible, and does the old code still run during deploy?

## Backward compatibility
- API responses: no removed or renamed fields, no changed types, without a version bump or an agreed contract change in `docs/api-<topic>.md`.
- Stored data: old rows still load.

## Transaction boundaries
- Writes that must succeed together are in one transaction.
- No network call (payment gateway, email) inside an open DB transaction unless the design says why.
- Idempotency key insert and the payment row are in the same transaction.
