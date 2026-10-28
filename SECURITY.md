# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report privately through
[GitHub's private vulnerability reporting](https://github.com/Abuarchiv/manawg-app/security/advisories/new).
If you cannot use GitHub, write to info@manawg.com.

Include what is affected, how to reproduce it and what an attacker could do with it.

ManaWG is maintained by one person. You can expect:

- an acknowledgement within 7 days;
- a first assessment (accepted, need more information, or not a vulnerability) within 14 days;
- a fix as soon as practical, with severity deciding the order, and a status update at least
  every 14 days until it is resolved.

Once a fix is out, we publish an advisory and credit you unless you prefer to stay anonymous.
Please keep the details private until then.

## Scope

- This repository and the official instance at app.manawg.com.
- Not in scope: instances run by others (report to their operator), denial of service through
  traffic volume, and findings that need physical access to an unlocked device.

Test only against your own account and WG, or a local instance. Do not access other people's data
and do not run automated scans against app.manawg.com.

## Supported versions

There are no numbered releases yet. Security fixes go into `main` and the deployment built from
it. Self-hosted instances get them by updating (see the
[self-hosting guide](docs/self-hosting.md#updating)).
