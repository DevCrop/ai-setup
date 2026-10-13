# Optional PHP/MySQL encoding reference

Use only when the project actually uses PHP/MySQL and an encoding or schema change
is in scope. This is a project-authoring reference, not an automatically loaded skill.

- Prefer utf8mb4 for new MySQL schemas and connections. Preserve existing project conventions unless an encoding migration is requested.
- When configuring PHP PDO MySQL connections, specify charset=utf8mb4 explicitly.
- Do not silently convert legacy utf8/utf8mb3 dumps. Review stored data, compatibility and migration consequences first.
- For an actual change, verify the affected schema/connection and representative Unicode round trips using the project's disposable test data. Do not scan unrelated databases on Markdown or SCSS edits.

Sources: [MySQL Unicode](https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-utf8mb4.html), [PHP PDO DSN](https://www.php.net/manual/en/ref.pdo-mysql.connection.php).
