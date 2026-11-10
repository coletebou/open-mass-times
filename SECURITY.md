# Security policy

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through GitHub:
[**Security → Report a vulnerability**](https://github.com/coletebou/open-mass-times/security/advisories/new).
Only the maintainers can see the report. We aim to reply within a week.

The same form is the private channel for Code of Conduct reports (start the
title with "Conduct:") and for parish data-removal requests ("Data:").

## Scope

Open Mass Times v0 is not deployed anywhere public. The API is read-only;
the most relevant risks are injection through data (all web rendering uses
`textContent`), query-parameter handling, and denial of service through
expensive queries (radius, day and result limits are enforced in
`src/api/app.ts`).
