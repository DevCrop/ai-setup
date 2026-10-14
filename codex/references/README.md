# Reference registry

`registry.json` is the authority for source identity, disposition and retrieval/review status. Exact user URLs are kept alongside canonical URLs. It lists the sources that back current policy, the monitored update channels and implementation references.

Fetched means a response was obtained; it does not mean full semantic review. Adopted tool means the user selected the tool, not that upstream performance claims are proven. Conditional references require review before new claims become policy. Stars and API pricing are not evidence of subscription usage savings.

Only source snapshots needed for current review are kept here. A snapshot path is recorded only after a file actually exists and its SHA-256 has been computed. Updaters must preserve failed retrievals as failures and compare relevant body changes before proposing policy updates.
